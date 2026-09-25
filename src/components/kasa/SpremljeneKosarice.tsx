import { Archive, FileClock, RotateCcw, Trash2 } from 'lucide-react';
import type { SkicaFakture } from '@/components/FakturaDialog';
import { cn, formatKM } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { stavkeTekst } from '@/lib/kosarica';

export interface SavedCartRow {
  id: number;
  naziv: string;
  items: string; // JSON: SavedCartItem[]
  ukupno: number;
  createdAt: string;
}

/** "2026-09-25 09:41:12" → "09:41"; drugi dan dobije i datum. */
function kada(createdAt: string): string {
  const [datum, vrijeme = ''] = createdAt.split(/[ T]/);
  const hhmm = vrijeme.slice(0, 5);
  if (datum === localDateStr()) return hhmm;
  const [, m, dan] = datum.split('-');
  return `${Number(dan)}.${Number(m)}. ${hhmm}`;
}

/** Broj stavki iz spremljenog JSON-a; pokvaren zapis ne ruši listu. */
function brojStavki(items: string): number | null {
  try { const v = JSON.parse(items); return Array.isArray(v) ? v.length : null; } catch { return null; }
}

/**
 * Parkirani računi u sidebaru kase: spremi trenutnu košaricu i vrati bilo koju jednim klikom.
 * Vraćanje briše zapis — košarica je ili parkirana ili na kasi, nikad oboje.
 * Iznad njih stoje skice faktura; skica ostaje dok se faktura ne fiskalizuje.
 */
export default function SpremljeneKosarice({ kosarice, skice, mozeSpremiti, onSpremi, onVrati, onObrisi, onNastaviSkicu, onObrisiSkicu }: {
  kosarice: SavedCartRow[];
  skice: SkicaFakture[];
  mozeSpremiti: boolean;
  onSpremi: () => void;
  onVrati: (k: SavedCartRow) => void;
  onObrisi: (id: number) => void;
  onNastaviSkicu: (s: SkicaFakture) => void;
  onObrisiSkicu: (id: number) => void;
}) {
  const ukupno = kosarice.length + skice.length;
  return (
    <section aria-labelledby="spremljene-naslov" className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-5 pb-2">
        <h3 id="spremljene-naslov" className="flex items-center gap-2 text-[12.5px] font-semibold text-slate-700">
          Spremljene košarice
          {ukupno > 0 && (
            <span className="rounded-full bg-amber-100 px-1.5 font-mono text-[10.5px] tabular-nums text-amber-700">{ukupno}</span>
          )}
        </h3>
        <button
          type="button" onClick={onSpremi} disabled={!mozeSpremiti}
          title="Skloni trenutni račun sa kase i nastavi ga kasnije"
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
        >
          <Archive className="h-3.5 w-3.5" /> Spremi trenutnu
        </button>
      </div>

      {ukupno === 0 ? (
        <p className="mx-5 rounded-lg border border-dashed border-slate-200 px-3 py-3 text-[11.5px] leading-relaxed text-slate-400">
          Mušterija se vraća kasnije? Spremite račun i nastavite s drugim kupcem.
        </p>
      ) : (
        <ul className="min-h-0 space-y-1 overflow-y-auto px-3 pb-1">
          {skice.map(s => (
            <li key={`skica-${s.id}`} className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-blue-50/60">
              <button
                type="button" onClick={() => onNastaviSkicu(s)}
                title="Nastavi fakturu"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
              >
                <FileClock className="h-4 w-4 flex-shrink-0 text-blue-500" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-slate-700">{s.naziv}</span>
                  <span className="block text-[11px] text-slate-400">
                    Skica fakture · <span className="font-mono tabular-nums">{kada(s.spremljeno)}</span>
                  </span>
                </span>
                <span className="font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">{formatKM(s.ukupno)}</span>
                <RotateCcw className="h-3.5 w-3.5 flex-shrink-0 text-blue-600 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
              <button
                type="button" onClick={() => onObrisiSkicu(s.id)}
                aria-label={`Obriši skicu fakture ${s.naziv}`}
                className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
          {kosarice.map(k => {
            const n = brojStavki(k.items);
            return (
              <li key={k.id} className="group flex items-center gap-1 rounded-lg transition-colors hover:bg-amber-50/60">
                <button
                  type="button" onClick={() => onVrati(k)}
                  title="Vrati na kasu"
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
                >
                  <span className="w-[5.5rem] flex-shrink-0 whitespace-nowrap font-mono text-[11.5px] tabular-nums text-slate-500">{kada(k.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500">
                    {n != null ? stavkeTekst(n) : k.naziv}
                  </span>
                  <span className="font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">{formatKM(k.ukupno)}</span>
                  <RotateCcw className={cn('h-3.5 w-3.5 flex-shrink-0 text-amber-600 opacity-0 transition-opacity group-hover:opacity-100')} />
                </button>
                <button
                  type="button" onClick={() => onObrisi(k.id)}
                  aria-label={`Obriši spremljenu košaricu ${k.naziv}`}
                  className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
