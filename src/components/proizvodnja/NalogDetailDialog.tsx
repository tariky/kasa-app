// src/components/proizvodnja/NalogDetailDialog.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProizvodPonude, RadniNalog } from '@/types';
import type { Kalkulacija } from '@/lib/proizvodnja';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { formatBrojPonude } from '@/lib/ponuda';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
import { rokOznaka, uskladiIzbor, proizvodiIzIzbora } from '@/lib/nalogPrikaz';
import { localDateStr } from '@/lib/novac';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { otvoriPdf, spremiPdf, ucitajZaStampu } from '@/lib/stampa';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, jePoljeZaUnos, mod } from '@/components/ui/ledger';
import { FullDialog, FullDialogContent, FullDialogHeader, FullDialogFooter, FullDialogNotice, FullDialogTitle, FooterBtn, Fact, HeaderBtn, LegendKey, SusjedniNav } from '@/components/ui/full-dialog';
import { RadniNalogPdf } from '@/components/RadniNalogPdf';
import { StatusRail } from './StatusRail';
import { StavkeUtroska, type StavkeHandle } from './StavkeUtroska';
import { KalkulacijaPanel } from './KalkulacijaPanel';
import { ProizvodiNaloga } from './ProizvodiNaloga';
import { NalogDialog } from './NalogDialog';
import { IzdajRacunDialog } from './IzdajRacunDialog';
import { useSusjedni } from '@/hooks/useSusjedni';
import { useCuvarIzmjena } from '@/hooks/useCuvarIzmjena';
import { Pencil, Trash2, Play, CheckCircle2, Undo2, Receipt, Printer, Download, User, Package } from 'lucide-react';

type Notice = { type: 'success' | 'error'; text: string };

const ROK_TONE = { ok: 'bg-emerald-50 text-emerald-700', warn: 'bg-amber-50 text-amber-700', late: 'bg-rose-50 text-rose-700' } as const;

/**
 * Radni nalog preko cijelog ekrana. Zaglavlje nosi broj i tok naloga, tijelo utrošak
 * i kalkulaciju, podnožje sljedeći korak. Tastatura: ↑↓ susjedni nalog, ⌘S spremi,
 * ⌘↵ sljedeći korak, P štampa, S PDF, U uredi, D obriši, / pretraga, esc zatvori.
 */
export function NalogDetailDialog({ nalogId, redoslijed, uloga, onClose, onNavigate, onChanged, onDeleted }: {
  nalogId: number | null; redoslijed: number[]; uloga: 'admin' | 'kasir';
  onClose: () => void; onNavigate: (id: number) => void; onChanged: () => void; onDeleted: (n: RadniNalog) => void;
}) {
  const { postavke } = useDokumentPostavke();
  const [nalog, setNalog] = useState<RadniNalog | null>(null);
  const [kalk, setKalk] = useState<Kalkulacija | null>(null);
  const [linijePonude, setLinijePonude] = useState<ProizvodPonude[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [stavkeDirty, setStavkeDirty] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [brisiOpen, setBrisiOpen] = useState(false);
  const [zavrsiOpen, setZavrsiOpen] = useState(false);
  const [vratiOpen, setVratiOpen] = useState(false);
  const [racunOpen, setRacunOpen] = useState(false);
  const stavkeRef = useRef<StavkeHandle>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const open = nalogId != null;
  const greska = (e: any) => setNotice({ type: 'error', text: e?.message || 'Greška' });

  const load = useCallback(async (id: number) => {
    try {
      const [n, k] = await Promise.all([window.api.getNalog(id), window.api.getNalogKalkulacija(id)]);
      setNalog(n); setKalk(k);
      setLinijePonude(n.ponudaId ? await window.api.getProizvodiPonude(n.ponudaId) : []);
    } catch (e) { greska(e); }
  }, []);

  useEffect(() => {
    if (nalogId == null) { setNalog(null); setKalk(null); setLinijePonude([]); return; }
    setNotice(null); setStavkeDirty(false);
    load(nalogId);
  }, [nalogId, load]);

  const reload = useCallback(async () => {
    if (nalogId != null) await load(nalogId);
    onChanged();
  }, [nalogId, load, onChanged]);

  const uredivo = !!nalog && (nalog.status === 'otvoren' || nalog.status === 'u_izradi');
  // Spremljeni izbor prema ponudi kakva je sada; neusklađeni redovi se prikazuju posebno.
  const izbor = useMemo(() => uskladiIzbor(linijePonude, nalog?.proizvodi ?? []), [linijePonude, nalog]);
  const spremiIzbor = async (oznacene: Set<number>) => {
    if (!nalog || !uredivo) return;
    try { await window.api.setNalogProizvodi(nalog.id, proizvodiIzIzbora(linijePonude, oznacene)); await reload(); }
    catch (e) { greska(e); }
  };
  const promijeniProizvod = (ponudaStavkaId: number) => {
    const oznacene = new Set(izbor.oznacene);
    if (oznacene.has(ponudaStavkaId)) oznacene.delete(ponudaStavkaId); else oznacene.add(ponudaStavkaId);
    spremiIzbor(oznacene);
  };
  useEffect(() => { if (!uredivo) setStavkeDirty(false); }, [uredivo]);

  const susjedni = useSusjedni(redoslijed, nalogId);

  // Nespremljene stavke čuvaju od zatvaranja i skakanja na drugi nalog — prvo pitamo.
  const cuvar = useCuvarIzmjena(stavkeDirty, {
    onClose, onNavigate,
    onSpremi: async () => !!(await stavkeRef.current?.save()),
    naslov: 'Nespremljene stavke',
    opis: 'Utrošak materijala ima izmjene koje nisu spremljene.',
  });

  // ── akcije ────────────────────────────────────────────
  const uIzradu = async () => {
    if (!nalog) return;
    try { await window.api.setNalogStatus({ id: nalog.id, status: 'u_izradi' }); await reload(); }
    catch (e) { greska(e); }
  };
  const zavrsi = async () => {
    if (!nalog) return;
    try {
      await window.api.setNalogStatus({ id: nalog.id, status: 'zavrsen' });
      setZavrsiOpen(false); await reload();
      setNotice({ type: 'success', text: 'Nalog završen, materijal razdužen' });
    } catch (e) { greska(e); setZavrsiOpen(false); }
  };
  const vrati = async () => {
    if (!nalog) return;
    try { await window.api.setNalogStatus({ id: nalog.id, status: 'vrati' }); setVratiOpen(false); await reload(); }
    catch (e) { greska(e); setVratiOpen(false); }
  };
  const obrisi = async () => {
    if (!nalog) return;
    try { await window.api.deleteNalog(nalog.id); setBrisiOpen(false); onDeleted(nalog); }
    catch (e) { greska(e); }
  };

  const nalogPdf = async (n: RadniNalog) => {
    const { firma, postavke } = await ucitajZaStampu();
    return <RadniNalogPdf nalog={n} firma={firma} postavke={postavke} />;
  };
  const printPdf = async () => {
    if (!nalog || stavkeDirty) return;
    await otvoriPdf(await nalogPdf(nalog));
  };
  const exportPdf = async () => {
    if (!nalog || stavkeDirty) return;
    await spremiPdf(await nalogPdf(nalog), `RadniNalog-${nalog.broj}-${nalog.godina}.pdf`);
  };

  const mozeZavrsiti = uredivo && (nalog?.stavke?.length ?? 0) > 0;
  const mozeRacun = nalog?.status === 'zavrsen' && nalog.vrsta === 'narudzba';
  const primarna = mozeZavrsiti ? () => setZavrsiOpen(true) : mozeRacun ? () => setRacunOpen(true) : null;
  const anySub = editOpen || brisiOpen || zavrsiOpen || vratiOpen || racunOpen || cuvar.otvoren;

  // ── tastatura ─────────────────────────────────────────
  // Sluša samo događaje iz ovog dijaloga: ugniježdeni dijalozi su portali izvan njega
  // pa ih sami preskaču, a stanje pod-dijaloga gasi i ostatak.
  useEffect(() => {
    if (!open || anySub) return;
    const onKey = (e: KeyboardEvent) => {
      if (!contentRef.current?.contains(e.target as Node)) return;
      const modKey = e.metaKey || e.ctrlKey;
      if (modKey && !e.altKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 's') { e.preventDefault(); stavkeRef.current?.save(); return; }
        if (e.key.toLowerCase() === 'f') { if (uredivo) { e.preventDefault(); stavkeRef.current?.focusSearch(); } return; }
        if (e.key === 'Enter') { if (primarna && !stavkeDirty) { e.preventDefault(); primarna(); } return; }
        return;
      }
      if (e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (jePoljeZaUnos(t)) return;
      if (t && t.getAttribute('role') === 'combobox') return;

      switch (e.key) {
        case 'ArrowUp': if (susjedni.prev != null) { e.preventDefault(); cuvar.zatrazi({ kind: 'nav', id: susjedni.prev }); } return;
        case 'ArrowDown': if (susjedni.next != null) { e.preventDefault(); cuvar.zatrazi({ kind: 'nav', id: susjedni.next }); } return;
        case '/': if (uredivo) { e.preventDefault(); stavkeRef.current?.focusSearch(); } return;
        default:
      }
      switch (e.key.toLowerCase()) {
        case 'p': e.preventDefault(); printPdf(); break;
        case 's': e.preventDefault(); exportPdf(); break;
        case 'u': if (uredivo || nalog?.status === 'zavrsen') { e.preventDefault(); setEditOpen(true); } break;
        case 'd': if (uredivo) { e.preventDefault(); setBrisiOpen(true); } break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const danas = localDateStr();
  const rok = nalog ? rokOznaka(nalog.rok, danas, nalog.status === 'zavrsen' || nalog.status === 'fakturisan') : null;

  return (
    <FullDialog open={open} onRequestClose={() => cuvar.zatrazi({ kind: 'close' })}>
      <FullDialogContent ref={contentRef} onRequestClose={() => cuvar.zatrazi({ kind: 'close' })}>
          {!nalog && <FullDialogTitle className="sr-only">Radni nalog</FullDialogTitle>}
          {nalog && (
            <>
              <FullDialogHeader
                eyebrow={nalog.vrsta === 'narudzba' ? 'Nalog po narudžbi' : 'Nalog za zalihu'}
                title={formatBrojNaloga(nalog, postavke.nalog.broj)}
                description={<>
                  {nalog.vrsta === 'narudzba' ? nalog.kupacNaziv : `${nalog.productNaziv} × ${nalog.kolicina}`}
                  {nalog.opis && nalog.opis !== nalog.productNaziv && <span className="text-white/45"> · {nalog.opis}</span>}
                </>}
                actions={(uredivo || nalog.status === 'zavrsen') && <HeaderBtn icon={Pencil} label="Uredi" hint="U" onClick={() => setEditOpen(true)} />}
              >
                <div className="mt-4 max-w-[720px]">
                  <StatusRail nalog={nalog} />
                </div>
              </FullDialogHeader>

              {notice && <FullDialogNotice type={notice.type} text={notice.text} onClose={() => setNotice(null)} />}

              {/* ── Tijelo ── */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-x-8 gap-y-6 px-6 py-5">
                  <div className="min-w-0 space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4">
                      {nalog.vrsta === 'narudzba' ? (
                        <Fact label="Kupac" className="col-span-2">
                          <span className="flex items-start gap-2"><User size={14} className="text-slate-400 mt-[2px] flex-shrink-0" />
                            <span><span className="font-medium">{nalog.kupacNaziv || '—'}</span>
                              {(nalog.kupacGrad || nalog.kupacAdresa) && <span className="block text-[11.5px] text-slate-400">{[nalog.kupacAdresa, nalog.kupacGrad].filter(Boolean).join(', ')}</span>}
                            </span>
                          </span>
                        </Fact>
                      ) : (
                        <Fact label="Proizvod" className="col-span-2">
                          <span className="flex items-start gap-2"><Package size={14} className="text-slate-400 mt-[2px] flex-shrink-0" />
                            <span><span className="font-medium">{nalog.productNaziv}</span> <span className="font-mono tabular-nums">× {nalog.kolicina}</span>
                              {nalog.productCijena != null && <span className="block text-[11.5px] text-slate-400">prodajna {formatKM(nalog.productCijena)}</span>}
                            </span>
                          </span>
                        </Fact>
                      )}
                      <Fact label="Datum"><span className="font-mono tabular-nums">{formatDate(nalog.datum)}</span></Fact>
                      <Fact label="Rok isporuke">
                        {nalog.rok ? (
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono tabular-nums">{formatDate(nalog.rok)}</span>
                            {rok && <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-semibold', ROK_TONE[rok.tone])}>{rok.label}</span>}
                          </span>
                        ) : <span className="text-slate-300">—</span>}
                      </Fact>
                      {nalog.vrsta === 'narudzba' && (
                        <Fact label="Dogovorena cijena">
                          {nalog.dogovorenaCijena != null
                            ? <span className="font-mono tabular-nums font-semibold">{formatKM(nalog.dogovorenaCijena)}</span>
                            : <span className="text-amber-600 text-[12px]">nije upisana</span>}
                        </Fact>
                      )}
                      {nalog.ponudaBroj && <Fact label="Iz ponude"><span className="font-mono">{formatBrojPonude({ broj: nalog.ponudaBroj, godina: nalog.ponudaGodina ?? 0 }, postavke.ponuda.broj)}</span></Fact>}
                      {nalog.racunBroj && (
                        <Fact label="Fiskalni račun">
                          <span className="font-mono font-medium text-violet-600">#{nalog.racunBroj}</span>
                          {nalog.racunStatus === 'refunded' && <span className="ml-1.5 text-[11px] text-rose-500">stornirano</span>}
                        </Fact>
                      )}
                      {nalog.korisnikIme && <Fact label="Otvorio"><span className="text-slate-600">{nalog.korisnikIme}</span></Fact>}
                      {nalog.napomena && <Fact label="Napomena" className="col-span-2 md:col-span-4"><span className="text-slate-600">{nalog.napomena}</span></Fact>}
                    </div>

                    {nalog.ponudaId != null && (linijePonude.length > 0 || izbor.neuskladjeni.length > 0) && (
                      <ProizvodiNaloga linije={linijePonude} oznacene={izbor.oznacene} onToggle={promijeniProizvod} zakljucano={!uredivo}
                        neuskladjeni={izbor.neuskladjeni} onUkloniNeuskladjene={() => spremiIzbor(izbor.oznacene)} />
                    )}

                    <StavkeUtroska
                      ref={stavkeRef}
                      nalogId={nalog.id}
                      stavke={nalog.stavke ?? []}
                      uredivo={uredivo}
                      kalkStavke={kalk?.stavke}
                      onDirtyChange={setStavkeDirty}
                      onSave={async (stavke) => { await window.api.saveNalogStavke(nalog.id, stavke); await reload(); }}
                    />
                  </div>

                  <aside className="lg:sticky lg:top-0 self-start space-y-4">
                    <KalkulacijaPanel
                      nalog={nalog} kalkulacija={kalk} uredivo={uredivo}
                      onTrosakRada={async (iznos) => { try { await window.api.updateNalog(nalog.id, { trosakRada: iznos }); await reload(); } catch (e) { greska(e); } }}
                    />
                  </aside>
                </div>
              </div>

              {/* ── Podnožje: sljedeći korak desno, tastatura lijevo ── */}
              <FullDialogFooter legend={<>
                  <SusjedniNav susjedni={susjedni} naziv="nalog" onIdi={nId => cuvar.zatrazi({ kind: 'nav', id: nId })} />
                  {uredivo && <LegendKey k="/">materijal</LegendKey>}
                  <LegendKey k="esc">zatvori</LegendKey>
                </>}>
                  {uredivo && <FooterBtn icon={Trash2} label="Obriši" hint="D" tone="danger" onClick={() => setBrisiOpen(true)} />}
                  <div className="flex items-center gap-1.5">
                    <FooterBtn icon={Printer} label="Štampaj" hint="P" onClick={printPdf} disabled={stavkeDirty} title={stavkeDirty ? 'Prvo spremite stavke' : undefined} />
                    <FooterBtn icon={Download} title="Sačuvaj PDF (S)" onClick={exportPdf} disabled={stavkeDirty} />
                  </div>
                  {nalog.status === 'otvoren' && <FooterBtn icon={Play} label="U izradu" onClick={uIzradu} />}
                  {nalog.status === 'zavrsen' && uloga === 'admin' && <FooterBtn icon={Undo2} label="Vrati u izradu" onClick={() => setVratiOpen(true)} />}
                  {mozeZavrsiti && (
                    <FooterBtn icon={CheckCircle2} label="Završi nalog" tone="primary" onClick={() => setZavrsiOpen(true)}
                      disabled={stavkeDirty} hint={stavkeDirty ? 'spremi stavke' : mod('↵')} />
                  )}
                  {mozeRacun && <FooterBtn icon={Receipt} label="Izdaj račun" tone="primary" onClick={() => setRacunOpen(true)} hint={mod('↵')} />}
              </FullDialogFooter>
            </>
          )}
      </FullDialogContent>

      {nalog && (
        <>
          <NalogDialog open={editOpen} onOpenChange={setEditOpen} nalog={nalog} stavkeNespremljene={stavkeDirty}
            onSaved={async () => { await reload(); setNotice({ type: 'success', text: 'Nalog izmijenjen' }); }} />

          <IzdajRacunDialog open={racunOpen} onOpenChange={setRacunOpen} nalog={nalog}
            onIzdat={async (bf) => { await reload(); setNotice({ type: 'success', text: `Račun #${bf ?? ''} izdat po nalogu ${formatBrojNaloga(nalog, postavke.nalog.broj)}` }); }}
            onNezavrseno={async (poruka) => { await reload(); setNotice({ type: 'error', text: poruka }); }} />

          {cuvar.dijalog}

          <Dialog open={brisiOpen} onOpenChange={setBrisiOpen}>
            <DialogContent className="sm:max-w-[400px]" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); obrisi(); } }}>
              <DialogHeader>
                <DialogTitle>Obrisati nalog {formatBrojNaloga(nalog, postavke.nalog.broj)}?</DialogTitle>
                <DialogDescription>Nalog nije završen pa ništa nije knjiženo. Brisanje se ne može poništiti.</DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setBrisiOpen(false)}>Otkaži</Button>
                <Button variant="destructive" onClick={obrisi}>Obriši <Key tone="danger">{mod('↵')}</Key></Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={zavrsiOpen} onOpenChange={setZavrsiOpen}>
            <DialogContent className="sm:max-w-[460px]" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); zavrsi(); } }}>
              <DialogHeader>
                <DialogTitle>Završiti nalog {formatBrojNaloga(nalog, postavke.nalog.broj)}?</DialogTitle>
                <DialogDescription>
                  Materijal se skida sa skladišta po stavkama utroška i nabavne cijene se zamrzavaju.
                  {nalog.vrsta === 'zaliha' && ` Na stanje ulazi ${nalog.kolicina} × ${nalog.productNaziv}.`}
                </DialogDescription>
              </DialogHeader>
              {kalk && kalk.upozorenja.length > 0 && (
                <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 space-y-0.5">
                  {kalk.upozorenja.map((u, i) => <p key={i} className="text-[11.5px] text-amber-700">{u}</p>)}
                  <p className="text-[11px] text-amber-600/80 pt-1">Završetak nije blokiran — stanje će ići u minus dok se ne unese primka.</p>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setZavrsiOpen(false)}>Otkaži</Button>
                <Button onClick={zavrsi}>Završi i razduži <Key tone="dark">{mod('↵')}</Key></Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={vratiOpen} onOpenChange={setVratiOpen}>
            <DialogContent className="sm:max-w-[420px]" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); vrati(); } }}>
              <DialogHeader>
                <DialogTitle>Vratiti nalog u izradu?</DialogTitle>
                <DialogDescription>Knjiženja završetka se brišu (materijal se vraća na stanje), stavke se otključavaju.</DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setVratiOpen(false)}>Otkaži</Button>
                <Button onClick={vrati}>Vrati u izradu <Key tone="dark">{mod('↵')}</Key></Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </FullDialog>
  );
}
