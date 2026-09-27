import { useState, useEffect } from 'react';
import { Calendar, Clock, Loader2, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Stat } from '@/components/ui/stat';
import CashMovementDialog from '@/components/CashMovementDialog';
import ZIzvjestajDialog from '@/components/izvjestaji/ZIzvjestajDialog';
import { cn, formatKM } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { fmtDisplay } from './dijelovi';

type FiskalniIzvjestaj = 'x' | 'z' | 'periodicni';

/** Red fiskalnog izvještaja: šta radi lijevo, dugme desno, ishod zadnje štampe ispod opisa. */
function FiskalniRed({ ikona: Ikona, naslov, oznaka, opis, akcija, opasno, zauzet, zakljucano, ishod, onClick }: {
  ikona: typeof Clock;
  naslov: string;
  oznaka: string;
  opis: string;
  akcija: string;
  opasno?: boolean;
  zauzet: boolean;
  zakljucano: boolean;
  ishod?: { ok: boolean; tekst: string };
  onClick: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-100 last:border-b-0">
      <Ikona size={18} strokeWidth={1.75} className={cn('flex-shrink-0', opasno ? 'text-rose-500' : 'text-slate-400')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13.5px] font-semibold text-slate-800">{naslov}</span>
          <span className="font-mono text-[11px] tabular-nums text-slate-400">{oznaka}</span>
        </div>
        <p className="mt-0.5 text-[12px] text-slate-500">{opis}</p>
        {ishod && (
          <p role="status" className={cn('mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium', ishod.ok ? 'text-emerald-600' : 'text-rose-600')}>
            <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', ishod.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
            {ishod.tekst}
          </p>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={zakljucano}
        className={cn('h-8 min-w-[124px] gap-1.5 text-[12px]', opasno && 'border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-300')}
      >
        {zauzet ? <><Loader2 size={13} className="animate-spin" />Štampam…</> : akcija}
      </Button>
    </div>
  );
}

/**
 * Tab Fiskalni: X, Z i periodični izvještaj na uređaju, stanje ladice danas, polog i povrat.
 *
 * Ekran ga drži montiranog i kad je drugi tab otvoren (`aktivan` = false ne crta ništa):
 * dok uređaj štampa, dugmad ostaju zaključana i poslije povratka na tab, a ishod
 * zadnje štampe ostaje vidljiv.
 */
export default function FiskalniTab({ aktivan, dateFrom, dateTo }: { aktivan: boolean; dateFrom: Date; dateTo: Date }) {
  const [stampa, setStampa] = useState<FiskalniIzvjestaj | null>(null);
  const [ishod, setIshod] = useState<Partial<Record<FiskalniIzvjestaj, { ok: boolean; tekst: string }>>>({});
  const [zPotvrda, setZPotvrda] = useState(false);

  const [ladica, setLadica] = useState<Awaited<ReturnType<typeof window.api.getDrawerState>> | null>(null);
  const [kretanja, setKretanja] = useState<Awaited<ReturnType<typeof window.api.getTodayCashMovements>>>([]);
  const [cashDialogTip, setCashDialogTip] = useState<'polog' | 'povrat' | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  const loadLadica = async () => {
    try {
      setLadica(await window.api.getDrawerState());
      setKretanja(await window.api.getTodayCashMovements());
    } catch { /* prikaz ladice je informativan — greška ne ruši tab */ }
  };

  const retryCash = async (id: number) => {
    setRetryingId(id);
    try {
      await window.api.retryCashMovement(id);
    } finally {
      setRetryingId(null);
      loadLadica();
    }
  };

  // Osvježi ladicu kad se tab otvori ili se promijeni period (kao ostali tabovi).
  useEffect(() => {
    if (aktivan) loadLadica();
  }, [aktivan, dateFrom, dateTo]);

  /** Uređaj štampa jedan po jedan — dok radi, sva tri dugmeta su zaključana. */
  const stampaj = async (vrsta: FiskalniIzvjestaj, poziv: () => Promise<any>) => {
    setStampa(vrsta);
    setIshod(p => ({ ...p, [vrsta]: undefined }));
    try {
      const result = await poziv();
      console.log(`Tring ${vrsta} result:`, result);
      const vrijeme = new Date().toTimeString().slice(0, 5);
      setIshod(p => ({
        ...p,
        [vrsta]: result?.success
          ? { ok: true, tekst: vrsta === 'z' ? `Dan zatvoren u ${vrijeme}` : `Odštampano u ${vrijeme}` }
          : { ok: false, tekst: result?.error || (result ? `Uređaj je odgovorio: ${result.vrstaOdgovora}` : 'Fiskalni uređaj nije odgovorio') },
      }));
    } catch (err: any) {
      setIshod(p => ({ ...p, [vrsta]: { ok: false, tekst: err?.message || 'Veza s fiskalnim uređajem nije uspjela' } }));
    } finally {
      setStampa(null);
      if (vrsta === 'z') loadLadica();
    }
  };

  const handleXReport = () => stampaj('x', () => window.api.tringXReport());
  const handleZReport = () => { setZPotvrda(false); stampaj('z', () => window.api.tringZReport()); };
  const handlePeriodicReport = () =>
    stampaj('periodicni', () => window.api.tringPeriodicReport(localDateStr(dateFrom), localDateStr(dateTo)));

  if (!aktivan) return null;

  return (
    <div className="h-full overflow-y-auto px-6 pt-5 pb-5 space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <span className="text-[13px] font-semibold text-slate-700">Fiskalni izvještaji</span>
        </div>
        <FiskalniRed
          ikona={Clock}
          naslov="Presjek stanja"
          oznaka="X"
          opis="Trenutni promet dana. Ništa se ne nulira, može se štampati koliko god puta."
          akcija="Štampaj"
          zauzet={stampa === 'x'}
          zakljucano={stampa !== null}
          ishod={ishod.x}
          onClick={handleXReport}
        />
        <FiskalniRed
          ikona={Moon}
          naslov="Dnevni izvještaj"
          oznaka="Z"
          opis="Zatvara dan i nulira promet na uređaju. Štampa se jednom, na kraju radnog dana."
          akcija="Zatvori dan…"
          opasno
          zauzet={stampa === 'z'}
          zakljucano={stampa !== null}
          ishod={ishod.z}
          onClick={() => setZPotvrda(true)}
        />
        <FiskalniRed
          ikona={Calendar}
          naslov="Periodični izvještaj"
          oznaka={`${fmtDisplay(dateFrom)} — ${fmtDisplay(dateTo)}`}
          opis="Zbir zatvorenih dana za period odabran u zaglavlju."
          akcija="Štampaj"
          zauzet={stampa === 'periodicni'}
          zakljucano={stampa !== null}
          ishod={ishod.periodicni}
          onClick={handlePeriodicReport}
        />
      </div>

      {/* Stanje ladice — lokalna evidencija pologa/povrata za danas */}
      <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <span className="text-[13px] font-semibold text-slate-700">Stanje ladice danas</span>
          <span className="hidden md:inline text-[12px] text-slate-400">Uporedi s presjekom stanja prije zatvaranja dana</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setCashDialogTip('polog')}>
              Polog
            </Button>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" onClick={() => setCashDialogTip('povrat')}>
              Povrat novca
            </Button>
          </div>
        </div>

        {ladica && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 p-5">
            <Stat label="Polozi" value={formatKM(ladica.polozi)} />
            <Stat label="Gotovinski promet" value={formatKM(ladica.gotovinskiPromet)} />
            <Stat label="Povrati" value={formatKM(-ladica.povrati)} />
            <Stat label="Reklamacije" value={formatKM(-ladica.gotovinskeReklamacije)} />
            <Stat label="Očekivano u ladici" value={formatKM(ladica.ocekivanoStanje)} strong
              className="col-span-2 lg:col-span-1 border-emerald-200 bg-emerald-50/50" />
          </div>
        )}

        {kretanja.length > 0 && (
          <div className="border-t border-slate-100 px-5">
            {kretanja.map(k => (
              <div key={k.id} className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-b-0 text-[12px]">
                <span className="font-mono text-[12px] text-slate-400 tabular-nums">{k.createdAt.slice(11, 16)}</span>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', k.tip === 'polog' ? 'bg-emerald-500' : 'bg-rose-500')} />
                  {k.tip === 'polog' ? 'Polog' : 'Povrat'}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-500">
                  {k.korisnikIme}{k.napomena ? <span className="text-slate-400"> · {k.napomena}</span> : null}
                </span>
                {k.tringStatus === 'error' && (
                  <Button
                    variant="outline" size="sm" className="h-7 px-2 text-[11px] text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                    disabled={retryingId === k.id}
                    onClick={() => retryCash(k.id)}
                  >
                    {retryingId === k.id ? 'Slanje…' : 'Nije poslano — ponovi'}
                  </Button>
                )}
                <span className={cn('font-mono text-[12.5px] font-semibold tabular-nums whitespace-nowrap', k.tip === 'polog' ? 'text-emerald-600' : 'text-rose-600')}>
                  {k.tip === 'polog' ? '+' : '−'}{formatKM(k.iznos)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <CashMovementDialog
        open={cashDialogTip !== null}
        tip={cashDialogTip ?? 'polog'}
        onClose={() => setCashDialogTip(null)}
        onSaved={loadLadica}
      />
      <ZIzvjestajDialog
        open={zPotvrda}
        ocekivano={ladica?.ocekivanoStanje ?? null}
        onClose={() => setZPotvrda(false)}
        onConfirm={handleZReport}
        onPresjek={() => { setZPotvrda(false); handleXReport(); }}
      />
    </div>
  );
}
