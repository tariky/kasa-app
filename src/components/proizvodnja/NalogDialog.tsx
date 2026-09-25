// src/components/proizvodnja/NalogDialog.tsx
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Kupac, Product, RadniNalog, NalogVrsta } from '@/types';
import { cn, formatKM, formatDate, parseDecimal } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
import { rokOznaka } from '@/lib/nalogPrikaz';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow, mod } from '@/components/ui/ledger';
import { FullDialog, FullDialogContent, FullDialogHeader, FullDialogFooter, FullDialogNotice, FooterBtn, Fact, LegendKey } from '@/components/ui/full-dialog';
import { PretragaStavki, type PretragaStavkiHandle } from '@/components/ui/pretraga-stavki';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { User, Package, X, Save, FolderPlus, Lock } from 'lucide-react';

const ROK_TONE = { ok: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-700', late: 'bg-rose-50 text-rose-700' } as const;

const VRSTE = [
  { v: 'narudzba', label: 'Po narudžbi', opis: 'Izrada za poznatog kupca', Icon: User },
  { v: 'zaliha', label: 'Za zalihu', opis: 'Standardni proizvod na stanje', Icon: Package },
] as const;

/** Izabrani proizvod — iz kataloga ili iz JOIN polja naloga koji se uređuje. */
type Izabran = { id: number; naziv: string; sifra?: string; jm?: string; cijena?: number | null; stanje?: number | null };

interface Forma {
  vrsta: NalogVrsta;
  kupacId: number | null;
  proizvod: Izabran | null;
  kolicina: string;
  opis: string;
  datum: string;
  rok: string;
  cijena: string;
  napomena: string;
}

const prazna = (): Forma => ({
  vrsta: 'narudzba', kupacId: null, proizvod: null, kolicina: '1', opis: '',
  datum: localDateStr(), rok: '', cijena: '', napomena: '',
});

const izNaloga = (n: RadniNalog): Forma => ({
  vrsta: n.vrsta,
  kupacId: n.kupacId ?? null,
  proizvod: n.productId ? { id: n.productId, naziv: n.productNaziv ?? `#${n.productId}`, cijena: n.productCijena } : null,
  kolicina: String(n.kolicina),
  opis: n.opis,
  datum: n.datum,
  rok: n.rok ?? '',
  cijena: n.dogovorenaCijena != null ? String(n.dogovorenaCijena).replace('.', ',') : '',
  napomena: n.napomena ?? '',
});

const poljaKupca = (k: Kupac) => ({ naziv: k.naziv, dodatno: [k.idBroj, k.pdvBroj, k.grad].filter(Boolean).join(' ') });

/**
 * Otvaranje i izmjena radnog naloga preko cijelog ekrana — isti jezik kao detalj naloga.
 * Zaglavlje nosi vrstu naloga, tijelo kupca/proizvod (fuzzy pretraga) i rokove, desno
 * pregled onoga što će nalog biti. ⌘↵ sprema, esc pita ako ima izmjena.
 */
export function NalogDialog({ open, onOpenChange, nalog, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  nalog: RadniNalog | null; onSaved: (id: number) => void;
}) {
  const { postavke } = useDokumentPostavke();
  const [forma, setForma] = useState<Forma>(prazna);
  const [pocetna, setPocetna] = useState('');
  const [kupci, setKupci] = useState<Kupac[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [odbaciOpen, setOdbaciOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const kupacRef = useRef<PretragaStavkiHandle>(null);
  const proizvodRef = useRef<PretragaStavkiHandle>(null);

  const isEdit = !!nalog;
  const zavrsen = nalog?.status === 'zavrsen';
  const set = <K extends keyof Forma>(k: K, v: Forma[K]) => setForma(f => ({ ...f, [k]: v }));

  const fokusirajIzbor = useCallback((vrsta: NalogVrsta) => {
    requestAnimationFrame(() => (vrsta === 'narudzba' ? kupacRef : proizvodRef).current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const f = nalog ? izNaloga(nalog) : prazna();
    setForma(f); setPocetna(JSON.stringify(f));
    setError(''); setOdbaciOpen(false);
    window.api.getKupci().then(setKupci).catch(() => setKupci([]));
    if (!nalog) fokusirajIzbor(f.vrsta);
  }, [open, nalog, fokusirajIzbor]);

  const kupac = useMemo(() => kupci?.find(k => k.id === forma.kupacId) ?? null, [kupci, forma.kupacId]);
  // Kupac naloga koji se uređuje poznat je iz JOIN polja i prije nego se lista kupaca učita.
  const kupacNaziv = kupac?.naziv ?? (nalog && nalog.kupacId === forma.kupacId ? nalog.kupacNaziv : null);
  const kupacAdresa = kupac ? [kupac.adresa, kupac.grad].filter(Boolean).join(', ')
    : nalog && nalog.kupacId === forma.kupacId ? [nalog.kupacAdresa, nalog.kupacGrad].filter(Boolean).join(', ') : '';

  const kolicinaBroj = parseDecimal(forma.kolicina);
  const cijenaBroj = forma.cijena ? parseDecimal(forma.cijena) : null;
  const dirty = open && pocetna !== '' && JSON.stringify(forma) !== pocetna;

  const fali = forma.vrsta === 'narudzba'
    ? (!forma.kupacId ? 'Izaberite kupca' : !forma.opis.trim() ? 'Upišite opis narudžbe' : null)
    : (!forma.proizvod ? 'Izaberite proizvod' : !(kolicinaBroj > 0) ? 'Upišite količinu' : null);

  const zatvori = () => onOpenChange(false);
  const zatraziZatvaranje = () => { if (dirty && !saving) setOdbaciOpen(true); else zatvori(); };

  const promijeniVrstu = (v: NalogVrsta) => {
    if (v === forma.vrsta) return;
    set('vrsta', v);
    fokusirajIzbor(v);
  };

  const spremi = async () => {
    if (fali || saving) return;
    setSaving(true); setError('');
    try {
      const rok = forma.rok || null;
      const napomena = forma.napomena.trim() || null;
      let payload: any;
      if (zavrsen) {
        payload = { dogovorenaCijena: cijenaBroj, rok, napomena };
      } else {
        payload = { opis: forma.opis.trim(), datum: forma.datum, rok, napomena, dogovorenaCijena: cijenaBroj };
        if (forma.vrsta === 'narudzba') payload.kupacId = forma.kupacId;
        else { payload.productId = forma.proizvod!.id; payload.kolicina = kolicinaBroj; }
      }
      let id: number;
      if (isEdit) { await window.api.updateNalog(nalog!.id, payload); id = nalog!.id; }
      else { const r = await window.api.createNalog({ ...payload, vrsta: forma.vrsta }); id = r.id; }
      zatvori();
      onSaved(id);
    } catch (e: any) { setError(e?.message || 'Nalog nije spremljen'); }
    finally { setSaving(false); }
  };

  // ⌘↵ sprema iz bilo kojeg polja; pretraga bez "nove stavke" pušta ⌘↵ roditelju.
  useEffect(() => {
    if (!open || odbaciOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) { e.preventDefault(); spremi(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const danas = localDateStr();
  const rokInfo = rokOznaka(forma.rok, danas);
  const zaliha = forma.vrsta === 'zaliha';
  const naslov = nalog ? formatBrojNaloga(nalog, postavke.nalog.broj) : 'Novi nalog';
  const opisZaglavlja = zaliha
    ? (forma.proizvod ? `${forma.proizvod.naziv} × ${forma.kolicina || '—'}` : <span className="text-white/40">proizvod nije izabran</span>)
    : (kupacNaziv || <span className="text-white/40">kupac nije izabran</span>);

  return (
    <FullDialog open={open} onRequestClose={zatraziZatvaranje}>
      <FullDialogContent ref={contentRef} onRequestClose={zatraziZatvaranje}>
        <FullDialogHeader
          eyebrow={isEdit ? 'Izmjena radnog naloga' : 'Novi radni nalog'}
          title={naslov}
          description={opisZaglavlja}
        >
          {!isEdit && (
            <div role="radiogroup" aria-label="Vrsta naloga" className="mt-4 grid grid-cols-2 gap-2 max-w-[520px]">
              {VRSTE.map(({ v, label, opis, Icon }) => {
                const on = forma.vrsta === v;
                return (
                  <button key={v} type="button" role="radio" aria-checked={on} onClick={() => promijeniVrstu(v)}
                    className={cn(
                      'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-left transition-colors duration-150',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                      on ? 'bg-white text-[#0f1629]' : 'bg-white/[0.06] text-white/70 hover:bg-white/10 hover:text-white',
                    )}>
                    <span className={cn('grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg', on ? 'bg-[#0f1629] text-white' : 'bg-white/10')}>
                      <Icon size={15} strokeWidth={1.75} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-semibold leading-tight">{label}</span>
                      <span className={cn('block text-[11.5px] leading-tight mt-0.5 truncate', on ? 'text-slate-500' : 'text-white/45')}>{opis}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </FullDialogHeader>

        {error && <FullDialogNotice type="error" text={error} onClose={() => setError('')} />}
        {zavrsen && (
          <div role="status" className="flex-shrink-0 flex items-center gap-2 px-6 py-2 text-[12px] font-medium border-b bg-amber-50 border-amber-100 text-amber-700">
            <Lock size={12} /> Nalog je završen, pa se mijenjaju samo cijena, rok i napomena.
          </div>
        )}

        {/* ── Tijelo ── */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-x-8 gap-y-6 px-6 py-5">
            <div className="min-w-0 space-y-7">

              {/* Za koga / šta */}
              <section aria-label={zaliha ? 'Proizvod' : 'Kupac'} className="space-y-2">
                <div className="flex items-center h-5"><Eyebrow>{zaliha ? 'Proizvod' : 'Kupac'}</Eyebrow></div>
                {zaliha ? (
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3 items-start">
                    {forma.proizvod ? (
                      <Izabrano
                        icon={Package}
                        naslov={<>{forma.proizvod.sifra && <span className="font-mono text-[11.5px] text-slate-400 mr-2">{forma.proizvod.sifra}</span>}{forma.proizvod.naziv}</>}
                        detalj={[
                          forma.proizvod.cijena != null && `prodajna ${formatKM(forma.proizvod.cijena)}`,
                          forma.proizvod.stanje != null && `na stanju ${String(forma.proizvod.stanje).replace('.', ',')} ${forma.proizvod.jm ?? ''}`,
                        ].filter(Boolean).join(' · ')}
                        zakljucano={isEdit}
                        onPromijeni={() => { set('proizvod', null); fokusirajIzbor('zaliha'); }}
                      />
                    ) : (
                      <PretragaProizvoda
                        ref={proizvodRef}
                        tipovi={['artikal']}
                        nedavnoKljuc="nalog-proizvod"
                        placeholder="Traži proizvod po nazivu, šifri ili barkodu"
                        ariaLabel="Proizvod"
                        akcija="izaberi"
                        onIzaberi={(p: Product, kol) => {
                          setForma(f => ({
                            ...f,
                            proizvod: { id: p.id, naziv: p.naziv, sifra: p.sifra, jm: p.jm, cijena: p.cijena, stanje: p.stanje },
                            kolicina: kol != null ? String(kol).replace('.', ',') : f.kolicina,
                          }));
                        }}
                      />
                    )}
                    <div className="relative">
                      <DecimalInput maxDecimals={0} value={forma.kolicina} onValueChange={t => set('kolicina', t)} aria-label="Komada"
                        className="h-10 pr-12 text-right font-mono text-[13px] tabular-nums" disabled={zavrsen} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-slate-400">kom</span>
                    </div>
                  </div>
                ) : forma.kupacId ? (
                  <Izabrano
                    icon={User}
                    naslov={kupacNaziv ?? '…'}
                    detalj={[kupacAdresa, kupac?.idBroj && `ID ${kupac.idBroj}`].filter(Boolean).join(' · ')}
                    zakljucano={zavrsen}
                    onPromijeni={() => { set('kupacId', null); fokusirajIzbor('narudzba'); }}
                  />
                ) : (
                  <PretragaStavki<Kupac>
                    ref={kupacRef}
                    stavke={kupci}
                    kljuc={k => k.id}
                    polja={poljaKupca}
                    sifre={false}
                    naslovSvih="Svi kupci"
                    nedavnoKljuc="nalog-kupac"
                    placeholder="Traži kupca po nazivu, ID broju ili gradu"
                    ariaLabel="Kupac"
                    akcija="izaberi"
                    oznaka={k => [k.adresa, k.grad].filter(Boolean).join(', ') || null}
                    meta={k => k.idBroj ? <span className="font-mono tabular-nums text-[11px] text-slate-400">{k.idBroj}</span> : null}
                    onIzaberi={k => set('kupacId', k.id)}
                  />
                )}
                {zaliha && <p className="text-[11.5px] text-slate-400">Otkucajte <span className="font-mono text-slate-500">5*</span> ispred naziva da odmah upišete količinu.</p>}
              </section>

              {/* Opis */}
              <section aria-label="Opis" className="space-y-2">
                <label htmlFor="nalog-opis" className="flex items-baseline gap-2 h-5">
                  <Eyebrow>Opis</Eyebrow>
                  <span className="text-[11px] text-slate-400">{zaliha ? 'opciono' : 'šta se izrađuje'}</span>
                </label>
                <textarea
                  id="nalog-opis" rows={3} value={forma.opis} onChange={e => set('opis', e.target.value)} disabled={zavrsen}
                  placeholder={zaliha ? 'Dodatni detalji izrade' : 'Kuhinja 3,2 m, bijela mat, radna ploča hrast'}
                  className={cn(
                    'block w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-800',
                    'placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-blue-400/70 focus:ring-[3px] focus:ring-blue-500/10',
                    'disabled:opacity-60',
                  )}
                />
              </section>

              {/* Rokovi i cijena */}
              <section aria-label="Rokovi i cijena" className="grid grid-cols-2 md:grid-cols-3 gap-x-5 gap-y-4">
                <Polje label="Datum otvaranja"><DatePicker value={forma.datum} onChange={v => set('datum', v)} disabled={zavrsen} /></Polje>
                <Polje label="Rok isporuke" pomoc={rokInfo && <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', ROK_TONE[rokInfo.tone])}>{rokInfo.label}</span>}>
                  <DatePicker value={forma.rok} onChange={v => set('rok', v)} />
                </Polje>
                {!zaliha && (
                  <Polje label="Dogovorena cijena" pomoc={<span className="text-[11px] text-slate-400">sa PDV-om</span>}>
                    <div className="relative">
                      <DecimalInput value={forma.cijena} onValueChange={t => set('cijena', t)} placeholder="0,00" aria-label="Dogovorena cijena"
                        className="h-10 pr-10 text-right font-mono text-[13px] tabular-nums" />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px] text-slate-400">KM</span>
                    </div>
                  </Polje>
                )}
              </section>

              <Polje label="Napomena" htmlFor="nalog-napomena" pomoc={<span className="text-[11px] text-slate-400">opciono, ide na štampu</span>}>
                <Input id="nalog-napomena" value={forma.napomena} onChange={e => set('napomena', e.target.value)} placeholder="npr. montaža subotom, kupac donosi okove"
                  className="h-10 text-[13px]" />
              </Polje>
            </div>

            {/* ── Pregled ── */}
            <aside className="lg:sticky lg:top-0 self-start">
              <section className="rounded-xl bg-slate-50/80 border border-slate-200/70 px-4 pt-3 pb-4" aria-label="Pregled naloga">
                <Eyebrow className="block mb-3">Pregled</Eyebrow>
                <div className="space-y-3.5">
                  {zaliha ? (
                    <Fact label="Na stanje ulazi">
                      {forma.proizvod
                        ? <><span className="font-medium">{forma.proizvod.naziv}</span> <span className="font-mono tabular-nums">× {forma.kolicina || '—'}</span></>
                        : <span className="text-slate-300">—</span>}
                    </Fact>
                  ) : (
                    <Fact label="Kupac">{kupacNaziv ? <span className="font-medium">{kupacNaziv}</span> : <span className="text-slate-300">—</span>}</Fact>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Fact label="Otvoren"><span className="font-mono tabular-nums">{forma.datum ? formatDate(forma.datum) : '—'}</span></Fact>
                    <Fact label="Rok">{forma.rok ? <span className="font-mono tabular-nums">{formatDate(forma.rok)}</span> : <span className="text-slate-300">—</span>}</Fact>
                  </div>
                  {!zaliha && (
                    <div className="flex items-baseline justify-between border-t border-slate-200/80 pt-3">
                      <span className="text-[12px] text-slate-500">Dogovoreno</span>
                      {cijenaBroj != null
                        ? <span className="font-mono text-[18px] font-semibold tabular-nums text-slate-900">{formatKM(cijenaBroj || 0)}</span>
                        : <span className="text-[12px] text-amber-600">nije upisano</span>}
                    </div>
                  )}
                </div>
              </section>
              {!isEdit && (
                <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-slate-500">
                  {zaliha
                    ? 'Nakon otvaranja dodajete utrošak materijala. Kad završite nalog, materijal se skida sa skladišta, a proizvod ulazi na stanje.'
                    : 'Nakon otvaranja dodajete utrošak materijala. Kad završite nalog, materijal se skida sa skladišta i po nalogu se izdaje račun.'}
                </p>
              )}
            </aside>
          </div>
        </div>

        <FullDialogFooter legend={<>
          <LegendKey k="tab">sljedeće polje</LegendKey>
          <LegendKey k={mod('↵')}>{isEdit ? 'spremi' : 'otvori nalog'}</LegendKey>
          <LegendKey k="esc">zatvori</LegendKey>
        </>}>
          {fali && <span className="text-[11.5px] text-slate-400 mr-1">{fali}</span>}
          <FooterBtn icon={X} label="Otkaži" onClick={zatraziZatvaranje} />
          <FooterBtn icon={isEdit ? Save : FolderPlus} tone="primary" onClick={spremi} disabled={!!fali || saving} hint={mod('↵')}
            label={saving ? 'Spremam…' : isEdit ? 'Spremi izmjene' : 'Otvori nalog'} />
        </FullDialogFooter>
      </FullDialogContent>

      <Dialog open={odbaciOpen} onOpenChange={setOdbaciOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Odbaciti izmjene?' : 'Odbaciti novi nalog?'}</DialogTitle>
            <DialogDescription>{isEdit ? 'Izmjene naloga nisu spremljene.' : 'Upisani podaci nisu spremljeni i nalog neće biti otvoren.'}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-between items-center gap-2 pt-2">
            <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => { setOdbaciOpen(false); zatvori(); }}>Odbaci</Button>
            <Button variant="ghost" onClick={() => setOdbaciOpen(false)}>Nastavi uređivanje</Button>
          </div>
        </DialogContent>
      </Dialog>
    </FullDialog>
  );
}

/** Labela u stilu zaglavlja grupa, polje ispod, pomoćni tekst desno od labele. */
function Polje({ label, htmlFor, pomoc, children }: { label: string; htmlFor?: string; pomoc?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={htmlFor} className="flex items-center justify-between gap-2 h-5">
        <Eyebrow>{label}</Eyebrow>
        {pomoc}
      </label>
      {children}
    </div>
  );
}

/** Izabrani kupac/proizvod umjesto pretrage — iste visine kao polje, s dugmetom za promjenu. */
function Izabrano({ icon: Icon, naslov, detalj, zakljucano, onPromijeni }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  naslov: ReactNode; detalj?: string; zakljucano?: boolean; onPromijeni: () => void;
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 rounded-lg border border-slate-200 bg-white pl-3 pr-1.5 py-1.5">
      <Icon size={15} className="flex-shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-slate-800 leading-snug">{naslov}</p>
        {detalj && <p className="truncate text-[11.5px] text-slate-400 leading-snug">{detalj}</p>}
      </div>
      {zakljucano ? (
        <Lock size={13} className="mr-2 flex-shrink-0 text-slate-300" aria-label="Ne može se mijenjati" />
      ) : (
        <button type="button" onClick={onPromijeni}
          className="h-7 flex-shrink-0 rounded-md px-2.5 text-[12px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
          Promijeni
        </button>
      )}
    </div>
  );
}
