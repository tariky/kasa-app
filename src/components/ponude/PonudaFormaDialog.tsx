import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Eyebrow, Key } from '@/components/ui/ledger';
import { AlertTriangle, FileText, Trash2 } from 'lucide-react';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
import { useStavkeDokumenta } from '@/hooks/useStavkeDokumenta';
import { izReda, uPayload, type RedStavke } from '@/lib/stavkeDokumenta';
import { formatBrojPonude, plusDana, danaIzmedju } from '@/lib/ponuda';
import { pdvStavke } from '@/lib/racun';
import { primijeniRabatKupca, formatRabat } from '@/lib/dokumentPostavke';
import { localDateStr } from '@/lib/novac';
import { formatKM } from '@/lib/utils';
import type { Kupac, Product } from '@/types';

/** "8 dana od datuma ponude" — bosanska množina: 1/21/31 dan, ostalo dana. */
function opisRoka(dana: number): string {
  if (dana <= 0) return 'Važi samo na dan ponude';
  const jednina = dana % 10 === 1 && dana % 100 !== 11;
  return `${dana} ${jednina ? 'dan' : 'dana'} od datuma ponude`;
}

/** Ponuda koja se uređuje — `ponuda:get` sa stavkama. */
export interface PonudaZaFormu {
  id: number;
  kupacId: number;
  datum: string;
  vaziDo: string;
  napomena?: string | null;
  stavke?: RedStavke[];
}

/** Zahtjev za formu: `ponuda` null = nova ponuda. null umjesto zahtjeva = forma zatvorena. */
export type ZahtjevForme = { ponuda: PonudaZaFormu | null } | null;

/**
 * Forma nove ponude ili izmjene postojeće. Svaki novi `zahtjev` (i ponovno
 * otvaranje iste ponude) puni polja iznova, u istom renderu u kojem se dijalog
 * otvara. Poslije uspješnog snimanja roditelj dobija poruku za traku i id
 * izmijenjene ponude (null za novu) — on zatvara formu i osvježava listu.
 */
export function PonudaFormaDialog({ zahtjev, kupci: sifarnikKupaca, onZatvori, onSpremljena }: {
  zahtjev: ZahtjevForme;
  /** Šifarnik kupaca (useKupci); null dok se učitava. */
  kupci: Kupac[] | null;
  onZatvori: () => void;
  onSpremljena: (poruka: string, izmijenjenaId: number | null) => Promise<void>;
}) {
  const { postavke } = useDokumentPostavke();
  const kupci = sifarnikKupaca ?? [];
  const [editId, setEditId] = useState<number | null>(null);
  const [kupacId, setKupacId] = useState<string>('');
  const [datum, setDatum] = useState('');
  const [vaziDo, setVaziDo] = useState('');
  const [napomena, setNapomena] = useState('');
  const {
    stavke, postavi: postaviStavke, dodaj: dodajStavku, izmijeni: izmijeniStavku, ukloni: ukloniStavku, totali: formTotali,
  } = useStavkeDokumenta();
  const [formError, setFormError] = useState('');
  const [formInfo, setFormInfo] = useState('');
  /** Rabat izabranog kupca — dobijaju ga stavke dodane poslije izbora. */
  const [rabatKupca, setRabatKupca] = useState(0);
  const [saving, setSaving] = useState(false);

  // Novi zahtjev puni formu u istom renderu (ne u efektu): dijalog se otvara već popunjen.
  const [zadnjiZahtjev, setZadnjiZahtjev] = useState<ZahtjevForme>(null);
  if (zahtjev !== zadnjiZahtjev) {
    setZadnjiZahtjev(zahtjev);
    if (zahtjev) {
      const p = zahtjev.ponuda;
      if (p) {
        setEditId(p.id);
        setKupacId(String(p.kupacId));
        setDatum(p.datum);
        setVaziDo(p.vaziDo);
        setNapomena(p.napomena || '');
        postaviStavke((p.stavke || []).map(izReda));
      } else {
        setEditId(null);
        setKupacId('');
        const danasnji = localDateStr();
        setDatum(danasnji);
        setVaziDo(plusDana(danasnji, postavke.ponuda.vaziDana));
        setNapomena('');
        postaviStavke([]);
      }
      setFormError('');
      // Spremljena ponuda se ne preračunava dok korisnik ne promijeni kupca.
      setFormInfo('');
      setRabatKupca(0);
    }
  }

  /** Rok važenja u danima — izveden iz para datuma, ne drži se posebno. */
  const rokDana = datum && vaziDo ? danaIzmedju(datum, vaziDo) : postavke.ponuda.vaziDana;

  /**
   * Pomjeranje datuma ponude nosi i rok sa sobom: dogovoreno je "8 dana",
   * a ne "do 18.08." — pa ostaje 8 dana i kad se ponuda datira unaprijed.
   */
  const promijeniDatum = (novi: string) => {
    setDatum(novi);
    setVaziDo(plusDana(novi, rokDana));
  };

  /** Izbor kupca u formi: njegov rabat ide na stavke bez rabata i na nove stavke. */
  const izaberiKupca = (novi: string) => {
    setKupacId(novi);
    const r = kupci.find(k => String(k.id) === novi)?.rabat ?? 0;
    setRabatKupca(r);
    if (r > 0) {
      postaviStavke(prev => primijeniRabatKupca(prev, r));
      setFormError('');
      setFormInfo(`Primijenjen rabat kupca ${formatRabat(r)}`);
    } else setFormInfo('');
  };

  const addStavka = (p: Product, kol: number | null) => dodajStavku(p, kol, { rabat: rabatKupca });

  const savePonuda = async () => {
    setFormError('');
    if (!kupacId) { setFormError('Odaberite kupca'); return; }
    if (stavke.length === 0) { setFormError('Dodajte najmanje jednu stavku'); return; }
    if (stavke.some(s => !s.kolicina || s.kolicina <= 0 || isNaN(s.cijena) || s.cijena < 0)) {
      setFormError('Provjerite količine i cijene stavki'); return;
    }
    setSaving(true);
    try {
      const payload = {
        kupacId: Number(kupacId),
        datum,
        vaziDo,
        napomena: napomena.trim() || undefined,
        stavke: uPayload(stavke),
      };
      if (editId != null) {
        await window.api.updatePonuda(editId, payload);
        await onSpremljena('Ponuda izmijenjena', editId);
      } else {
        const res = await window.api.createPonuda(payload);
        await onSpremljena(`Ponuda ${formatBrojPonude(res, postavke.ponuda.broj)} kreirana`, null);
      }
    } catch (err: any) {
      setFormError(err?.message || 'Nepoznata greška');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={zahtjev != null} onOpenChange={v => { if (!v) onZatvori(); }}>
      <DialogContent
        className="sm:max-w-[640px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col"
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); savePonuda(); } }}
      >
        <div className="px-6 pt-6 pb-4 flex-shrink-0">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <FileText className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <DialogTitle className="text-lg">
                  {editId != null ? 'Uredi ponudu' : 'Nova ponuda'}
                </DialogTitle>
                <DialogDescription className="text-xs mt-0.5">
                  Nefiskalni predračun — cijene se zamrzavaju u trenutku snimanja
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>
        <Separator />

        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Kupac + datumi */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Eyebrow className="block">Kupac</Eyebrow>
              <Select value={kupacId} onValueChange={izaberiKupca}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue placeholder="Odaberite kupca" />
                </SelectTrigger>
                <SelectContent>
                  {kupci.map(k => (
                    <SelectItem key={k.id} value={String(k.id)}>
                      {k.naziv} <span className="text-slate-400 font-mono text-[11px]">({k.idBroj})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sifarnikKupaca?.length === 0 && (
                <p className="text-[11px] text-amber-600">
                  Nema kupaca u šifarniku — dodajte kupca u Postavkama.
                </p>
              )}
              {formInfo && <p className="text-[11px] text-slate-500">{formInfo}</p>}
            </div>
            <div className="space-y-1.5">
              <Eyebrow className="block">Datum</Eyebrow>
              <DatePicker value={datum} onChange={promijeniDatum} className="h-9 text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Eyebrow className="block">Važi do</Eyebrow>
              <DatePicker
                value={vaziDo} onChange={setVaziDo} minDate={datum}
                className="h-9 text-[13px]"
              />
              <p className="text-[10px] text-slate-400">{opisRoka(rokDana)}</p>
            </div>
          </div>

          {/* Stavke */}
          <div className="space-y-2">
            <Eyebrow className="block">Stavke</Eyebrow>
            <PretragaProizvoda tipovi={['artikal', 'usluga']} onIzaberi={addStavka} nedavnoKljuc="ponuda"
              placeholder="Dodaj artikal ili uslugu: naziv, šifra ili barkod" />

            {stavke.length > 0 && (
              <div className="border border-slate-100 rounded-lg divide-y divide-slate-50">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50/70 text-[10px] font-semibold text-slate-400 uppercase tracking-[0.14em]">
                  <span className="w-4 flex-shrink-0" />
                  <span className="flex-1 min-w-0">Artikal</span>
                  <span className="w-16 text-right">Kol.</span>
                  <span className="w-20 text-right">Cijena</span>
                  <span className="w-14 text-right">Rabat %</span>
                  <span className="w-20 text-right">PDV</span>
                  <span className="w-[14px] flex-shrink-0" />
                </div>
                {stavke.map((s, i) => (
                  <div key={s.productId} className="flex items-center gap-2 px-3 py-2">
                    <span className="text-[10px] text-slate-300 font-mono w-4 text-right flex-shrink-0">{i + 1}</span>
                    <p className="flex-1 min-w-0 text-[12px] font-medium text-slate-700 truncate">{s.naziv}</p>
                    <div className="w-16">
                      <DecimalInput
                        value={s.kolicina}
                        onValueChange={(_, v) => izmijeniStavku(s.productId, { kolicina: isNaN(v) ? 0 : v })}
                        maxDecimals={3}
                        className="h-7 text-[12px] text-right font-mono"
                        title="Količina"
                      />
                    </div>
                    <div className="w-20">
                      <DecimalInput
                        value={s.cijena}
                        onValueChange={(_, v) => izmijeniStavku(s.productId, { cijena: isNaN(v) ? NaN : v })}
                        className="h-7 text-[12px] text-right font-mono"
                        title="Cijena"
                      />
                    </div>
                    <div className="w-14">
                      <DecimalInput
                        value={s.rabat}
                        onValueChange={(_, v) => izmijeniStavku(s.productId, { rabat: isNaN(v) ? 0 : Math.min(100, v) })}
                        className="h-7 text-[12px] text-right font-mono"
                        title="Rabat %"
                      />
                    </div>
                    <span className="w-20 text-right text-[12px] font-mono tabular-nums text-slate-500">
                      {s.pdvStopa === 'E'
                        ? formatKM(pdvStavke({
                            cijena: s.cijena || 0, kolicina: s.kolicina || 0,
                            rabat: s.rabat || 0, pdvStopa: s.pdvStopa,
                          }) || 0)
                        : '—'}
                    </span>
                    <button
                      onClick={() => ukloniStavku(s.productId)}
                      title={`Ukloni ${s.naziv}`}
                      aria-label={`Ukloni ${s.naziv}`}
                      className="text-slate-300 hover:text-rose-500 transition-colors flex-shrink-0"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-50/50">
                  <span className="text-[11px] text-slate-400">Ukupno</span>
                  <span className="text-[13px] font-mono font-bold text-slate-800 tabular-nums">
                    {formatKM(formTotali.ukupno)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Napomena */}
          <div className="space-y-1.5">
            <Eyebrow className="block">Napomena</Eyebrow>
            <Input
              value={napomena} onChange={e => setNapomena(e.target.value)}
              placeholder="Napomena na ponudi (opcionalno)" className="h-9 text-[13px]"
            />
          </div>

          {formError && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2 text-[12px] font-medium text-rose-600">
              <AlertTriangle size={13} />
              {formError}
            </div>
          )}
        </div>

        <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-between gap-3 flex-shrink-0">
          <span className="flex items-center gap-1.5 text-[10.5px] text-slate-400">
            <Key className="ml-0">⌘↵</Key> snimi · <Key className="ml-0">esc</Key> otkaži
          </span>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onZatvori}>Otkaži</Button>
            <Button onClick={savePonuda} disabled={saving} className="min-w-[140px]">
              {saving ? 'Snimam…' : editId != null ? 'Snimi izmjene' : 'Kreiraj ponudu'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
