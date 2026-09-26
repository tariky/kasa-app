import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DecimalInput } from '@/components/ui/decimal-input';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Trash2,
  ChevronRight, Building2, AlertTriangle, PackageOpen, CornerDownLeft, X,
} from 'lucide-react';
import { Kupac } from '@/types';
import { iznosStavke } from '@/lib/racun';
import { uPayload } from '@/lib/stavkeDokumenta';
import { useStavkeDokumenta } from '@/hooks/useStavkeDokumenta';
import { cn, formatKM } from '@/lib/utils';
import { localDateTimeInput } from '@/lib/novac';
import { NACINI_PLACANJA, type NacinPlacanja } from '@/lib/placanje';
import { IKONA_PLACANJA } from '@/components/NacinPlacanjaBirac';
import { Eyebrow } from '@/components/ui/ledger';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';
import { PretragaKupaca } from '@/components/PretragaKupaca';
import { KupacRacunaPolja } from '@/components/KupacRacunaPolja';
import { PRAZAN_KUPAC, izKupca, zaSlanje, type KupacRacuna } from '@/lib/kupacRacuna';

/** Kolone reda stavke — isti raster za zaglavlje i za redove. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_74px_96px_74px_100px_30px] gap-2 items-center';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  prefillBroj?: string;
}

export default function DodajRacunDialog({ open, onOpenChange, onSaved, prefillBroj }: Props) {
  const [brojFiskalnog, setBrojFiskalnog] = useState('');
  const [datum, setDatum] = useState(localDateTimeInput);
  const [nacinPlacanja, setNacinPlacanja] = useState<NacinPlacanja>('Gotovina');
  const {
    stavke, postavi: setStavke, dodaj: addProduct, izmijeni: updateStavka, ukloni: removeStavka, totali: { ukupno, pdvIznos },
  } = useStavkeDokumenta();
  const [kupacOpen, setKupacOpen] = useState(false);
  const [kupacIzSifarnika, setKupacIzSifarnika] = useState(false);
  const [kupac, setKupac] = useState<KupacRacuna>(PRAZAN_KUPAC);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && prefillBroj) setBrojFiskalnog(prefillBroj);
  }, [open, prefillBroj]);

  const pickKupac = (k: Kupac) => {
    setKupac(izKupca(k));
    setKupacIzSifarnika(true);
  };

  const clearKupac = () => {
    setKupac(PRAZAN_KUPAC);
    setKupacIzSifarnika(false);
  };

  const reset = () => {
    setBrojFiskalnog(''); setDatum(localDateTimeInput()); setNacinPlacanja('Gotovina');
    setStavke([]);
    setKupacOpen(false);
    setKupacIzSifarnika(false);
    setKupac(PRAZAN_KUPAC);
    setError('');
  };

  const handleSave = async () => {
    setError('');
    if (!brojFiskalnog.trim()) { setError('Unesi fiskalni broj računa'); return; }
    if (stavke.length === 0) { setError('Dodaj bar jednu stavku'); return; }
    if (!datum) { setError('Unesi datum i vrijeme računa'); return; }

    const createdAt = datum.replace('T', ' ') + ':00';

    setLoading(true);
    try {
      await window.api.createManualOrder({
        ukupno, pdvIznos, nacinPlacanja,
        brojFiskalnogRacuna: brojFiskalnog.trim(), createdAt, kupac: zaSlanje(kupac),
        stavke: uPayload(stavke),
      });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err: any) {
      setError(err?.message || 'Nepoznata greška');
    } finally {
      setLoading(false);
    }
  };

  const kupacPopunjen = Boolean(kupac.idBroj.trim() || kupac.naziv.trim());

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent
        className="max-w-3xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !loading) {
            e.preventDefault();
            handleSave();
          }
        }}
      >
        {/* ── Zaglavlje računa ── */}
        <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-slate-100">
          <DialogHeader className="mb-4">
            <Eyebrow>Ručni unos</Eyebrow>
            <DialogTitle className="text-[17px] font-bold tracking-tight text-slate-900 leading-tight">
              Fiskalni račun
            </DialogTitle>
          </DialogHeader>

          {prefillBroj && (
            <div className="flex items-center gap-2 mb-4 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
              <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
              <p className="text-[11.5px] text-amber-800">
                Popunjavate prazninu u fiskalnom nizu — broj <span className="font-mono font-semibold">#{prefillBroj}</span> nedostaje u bazi.
              </p>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
            <div className="space-y-1.5">
              <Eyebrow>Fiskalni broj <span className="text-rose-400">*</span></Eyebrow>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[15px] font-semibold text-slate-300 pointer-events-none">#</span>
                <Input
                  autoFocus
                  value={brojFiskalnog}
                  onChange={e => setBrojFiskalnog(e.target.value)}
                  placeholder="1234"
                  className="h-11 pl-7 font-mono text-[16px] font-semibold tracking-tight tabular-nums"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Eyebrow>Datum i vrijeme <span className="text-rose-400">*</span></Eyebrow>
              <DateTimePicker
                value={datum}
                onChange={setDatum}
                className="h-11 text-[13px]"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <Eyebrow className="flex-shrink-0">Plaćanje</Eyebrow>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {NACINI_PLACANJA.map(id => {
                const Icon = IKONA_PLACANJA[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setNacinPlacanja(id)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-[6px] px-2.5 h-7 text-[11.5px] font-medium transition-colors duration-150',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                      nacinPlacanja === id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                    )}
                  >
                    <Icon size={13} strokeWidth={1.75} />
                    {id}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Stavke ── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-5 space-y-4">

            <div>
              <div className="flex items-center justify-between mb-2">
                <Eyebrow>Stavke</Eyebrow>
              </div>

              <PretragaProizvoda tipovi={['artikal', 'usluga']} onIzaberi={addProduct} nedavnoKljuc="racun"
                placeholder="Šifra, barkod ili naziv artikla" />
            </div>

            {stavke.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-8 select-none">
                <PackageOpen size={20} className="text-slate-300 mb-2" strokeWidth={1.5} />
                <p className="text-[12.5px] font-medium text-slate-500">Račun je još prazan</p>
                <p className="text-[11.5px] text-slate-400 mt-0.5">Pretražite artikal iznad da ga dodate.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className={cn(GRID, 'bg-slate-50/70 border-b border-slate-200 px-3 py-2')}>
                  <Eyebrow>Artikal</Eyebrow>
                  <Eyebrow className="text-right">Kol.</Eyebrow>
                  <Eyebrow className="text-right">Cijena</Eyebrow>
                  <Eyebrow className="text-right">Rabat</Eyebrow>
                  <Eyebrow className="text-right">Iznos</Eyebrow>
                  <span />
                </div>
                <div className="divide-y divide-slate-100">
                  {stavke.map(s => (
                    <div key={s.productId} className={cn(GRID, 'px-3 py-2 hover:bg-slate-50/50 transition-colors')}>
                      <div className="min-w-0">
                        <p className="text-[12.5px] font-medium text-slate-700 truncate">{s.naziv}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] text-slate-400">{s.sifra}</span>
                          {s.pdvStopa === 'K' && (
                            <span className="inline-flex h-3.5 items-center rounded border border-slate-200 bg-slate-50 px-1 font-mono text-[8.5px] font-bold text-slate-500" title="Oslobođeno PDV-a">
                              K
                            </span>
                          )}
                        </div>
                      </div>
                      <DecimalInput
                        value={s.kolicina} maxDecimals={3}
                        className="h-8 text-right font-mono text-[12px] tabular-nums"
                        onValueChange={(_, n) => updateStavka(s.productId, { kolicina: n || 0 })}
                      />
                      <DecimalInput
                        value={s.cijena}
                        className="h-8 text-right font-mono text-[12px] tabular-nums"
                        onValueChange={(_, n) => updateStavka(s.productId, { cijena: n || 0 })}
                      />
                      <DecimalInput
                        value={s.rabat}
                        className="h-8 text-right font-mono text-[12px] tabular-nums"
                        onValueChange={(_, n) => updateStavka(s.productId, { rabat: Math.min(100, n || 0) })}
                      />
                      <span className="text-right font-mono text-[12.5px] font-semibold text-slate-800 tabular-nums">
                        {formatKM(iznosStavke({ cijena: s.cijena, kolicina: s.kolicina, rabat: s.rabat, pdvStopa: s.pdvStopa }))}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStavka(s.productId)}
                        title={`Ukloni ${s.naziv}`}
                        aria-label={`Ukloni ${s.naziv}`}
                        className="w-7 h-7 flex items-center justify-center rounded-md text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Kupac (opciono) ── */}
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setKupacOpen(o => !o)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-slate-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                <ChevronRight size={14} className={cn('text-slate-400 transition-transform duration-150', kupacOpen && 'rotate-90')} />
                <Building2 size={14} className="text-slate-400" />
                <span className="text-[12.5px] font-medium text-slate-600">Kupac</span>
                <span className="text-[11px] text-slate-400">opciono</span>
                {!kupacOpen && kupacPopunjen && (
                  <span className="ml-auto text-[11.5px] text-slate-500 truncate max-w-[45%]">
                    {kupac.naziv || '—'}
                    {kupac.idBroj && <span className="ml-1.5 font-mono text-[10px] text-slate-400">{kupac.idBroj}</span>}
                  </span>
                )}
              </button>
              {kupacOpen && (
                <div className="border-t border-slate-100 px-3 py-3">
                  <Eyebrow className="mb-2 block">Iz šifarnika</Eyebrow>
                  <PretragaKupaca
                    onIzaberi={pickKupac}
                    nedavnoKljuc="kupci-rucni-racun"
                    placeholder="Pretraži kupca po nazivu, JIB-u ili gradu…"
                    velicina="sm"
                  />

                  {kupacIzSifarnika && (
                    <div className="flex items-center gap-2 mt-2 rounded-lg bg-slate-50 px-3 py-1.5">
                      <Building2 size={12} className="text-slate-400 flex-shrink-0" />
                      <span className="text-[11px] text-slate-500 truncate">
                        Popunjeno iz šifarnika — polja ispod možete izmijeniti.
                      </span>
                      <button
                        type="button"
                        onClick={clearKupac}
                        className="ml-auto flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-rose-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 rounded"
                      >
                        <X size={11} /> Očisti
                      </button>
                    </div>
                  )}

                  <KupacRacunaPolja varijanta="oznake" className="mt-3 pt-3 border-t border-slate-100" value={kupac} onChange={setKupac} />
                </div>
              )}
              {kupacOpen && (
                <p className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 text-[11px] text-slate-400">
                  Kupac se upisuje na račun samo ako je popunjen ID broj.
                </p>
              )}
            </div>
          </div>
        </ScrollArea>

        {/* ── Total + akcije ── */}
        <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          {error && (
            <div className="flex items-center gap-2 mb-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[11.5px] font-medium text-rose-600">
              <AlertTriangle size={13} className="flex-shrink-0" />
              {error}
            </div>
          )}
          <div className="flex items-end justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-4 text-[11px] text-slate-400">
                <span>Osnovica <span className="ml-1 font-mono tabular-nums text-slate-500">{formatKM(ukupno - pdvIznos)}</span></span>
                <span>PDV <span className="ml-1 font-mono tabular-nums text-slate-500">{formatKM(pdvIznos)}</span></span>
              </div>
              <div className="flex items-baseline gap-2.5 mt-1">
                <Eyebrow>Ukupno</Eyebrow>
                <span className="font-mono text-[24px] font-bold tabular-nums tracking-tight text-slate-900">
                  {formatKM(ukupno)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }} disabled={loading}>
                Otkaži
              </Button>
              <Button onClick={handleSave} disabled={loading} className="gap-2 min-w-[150px]">
                {loading ? 'Spremam…' : 'Spremi račun'}
                {!loading && (
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-white/20 bg-white/10 px-1 py-px font-mono text-[9px] font-semibold text-white/70">
                    ⌃<CornerDownLeft size={9} />
                  </kbd>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
