// src/components/skladiste/PregledCijenaUlaza.tsx
// Prikaz onoga što spremanje ili brisanje ulaza radi s prodajnim cijenama. Podaci
// dolaze iz backenda (primka:pregled*), koji pokrene istu operaciju i poništi je —
// ovdje se ništa ne računa, samo prikazuje.
import type { PregledCijenaUlaza } from '@/types';
import { cn, formatKM } from '@/lib/utils';
import { AlertTriangle, RotateCcw, Tag, Lock } from 'lucide-react';

type Dokument = PregledCijenaUlaza['dokumenti'][number];

export const imaPromjena = (p: PregledCijenaUlaza | null | undefined) =>
  !!p && (p.dokumenti.length > 0 || p.bezZalihe.length > 0 || p.cijenaOstaje.length > 0);

/** Nivelacija nosi novu cijenu s ulaza; protunivelacija poništava cijenu (uklonjena stavka, povrat, brisanje). */
const VRSTA = {
  nivelacija: {
    naslov: 'Nivelacija', opis: 'nova cijena s ulaza', icon: AlertTriangle,
    box: 'bg-amber-50 border-amber-100', head: 'text-amber-700', text: 'text-amber-700', muted: 'text-amber-600/80', chip: 'bg-amber-100 text-amber-700',
  },
  protunivelacija: {
    naslov: 'Protunivelacija', opis: 'poništenje cijene', icon: RotateCcw,
    box: 'bg-sky-50 border-sky-100', head: 'text-sky-800', text: 'text-sky-800', muted: 'text-sky-700/80', chip: 'bg-sky-100 text-sky-800',
  },
} as const;

const razlikaTon = (x: number) => (x >= 0 ? 'text-emerald-600' : 'text-rose-600');
const kol = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(3).replace(/\.?0+$/, ''));

/** Sažet prikaz za bočnu kolonu forme ulaza. */
export function PregledCijenaAside({ pregled, zastario }: { pregled: PregledCijenaUlaza; zastario?: boolean }) {
  return (
    <div className={cn('space-y-4 transition-opacity', zastario && 'opacity-50')} aria-busy={zastario || undefined}>
      {pregled.dokumenti.map(d => <DokumentKartica key={d.brojNivelacije} d={d} />)}
      {pregled.bezZalihe.length > 0 && (
        <section className="rounded-xl bg-slate-50 border border-slate-200/70 px-4 py-3" aria-label="Promjena cijene bez nivelacije">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600"><Tag size={12} /> Nova cijena bez nivelacije</p>
          <ul className="mt-1.5 space-y-0.5">
            {pregled.bezZalihe.map(r => (
              <li key={r.productId} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                <span className="truncate">{r.productNaziv}</span>
                <span className="font-mono tabular-nums whitespace-nowrap">{formatKM(r.staraCijena)} → {formatKM(r.novaCijena)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10.5px] text-slate-500">Artikli nemaju zalihu, pa nema šta nivelisati — mijenja se samo cijena u prodaji.</p>
        </section>
      )}
      {pregled.cijenaOstaje.length > 0 && (
        <section className="rounded-xl bg-slate-50 border border-slate-200/70 px-4 py-3" aria-label="Cijene bez promjene u prodaji">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-600"><Lock size={12} /> Cijena u prodaji ostaje</p>
          <ul className="mt-1.5 space-y-0.5">
            {pregled.cijenaOstaje.map(r => (
              <li key={r.productId} className="flex items-center justify-between gap-2 text-[11px] text-slate-600">
                <span className="truncate">{r.productNaziv}</span>
                <span className="font-mono tabular-nums whitespace-nowrap">{formatKM(r.cijena)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10.5px] text-slate-500">Cijenu je kasnije promijenio drugi ulaz ili ručna izmjena. Nova cijena se pamti na ovom ulazu i važi ako se kasnija promjena poništi.</p>
        </section>
      )}
    </div>
  );
}

function DokumentKartica({ d }: { d: Dokument }) {
  const v = VRSTA[d.vrsta];
  const ukupno = d.stavke.reduce((s, x) => s + x.ukupnaRazlika, 0);
  return (
    <section className={cn('rounded-xl border px-4 py-3', v.box)} aria-label={`${v.naslov} ${d.brojNivelacije}`}>
      <p className={cn('flex items-center gap-1.5 text-[11.5px] font-semibold', v.head)}>
        <v.icon size={12} /> {v.naslov}
        <span className="ml-auto font-mono text-[10.5px] font-medium opacity-70">{d.brojNivelacije}</span>
      </p>
      <ul className="mt-1.5 space-y-1">
        {d.stavke.map(r => (
          <li key={r.productId} className={cn('text-[11px]', v.text)}>
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{r.productNaziv}</span>
              <span className="font-mono tabular-nums whitespace-nowrap">{formatKM(r.staraCijena)} → {formatKM(r.novaCijena)}</span>
            </span>
            <span className={cn('flex items-center justify-between gap-2 text-[10.5px]', v.muted)}>
              <span className="font-mono tabular-nums">zaliha {kol(r.kolicina)}</span>
              <span className={cn('font-mono tabular-nums font-semibold', razlikaTon(r.ukupnaRazlika))}>{formatKM(r.ukupnaRazlika)}</span>
            </span>
          </li>
        ))}
      </ul>
      {d.stavke.length > 1 && (
        <p className={cn('mt-1.5 pt-1.5 border-t border-dashed flex justify-between text-[10.5px]', v.muted, d.vrsta === 'nivelacija' ? 'border-amber-200' : 'border-sky-200')}>
          <span>Ukupno</span><span className={cn('font-mono tabular-nums font-semibold', razlikaTon(ukupno))}>{formatKM(ukupno)}</span>
        </p>
      )}
      <p className={cn('mt-1.5 text-[10.5px]', v.muted)}>{d.vrsta === 'nivelacija' ? 'Zaliha se niveliše na novu cijenu s ulaza.' : 'Cijena se vraća; nivelacija uz ulaz ostaje.'}</p>
    </section>
  );
}

/** Puni prikaz za dijalog potvrde (spremanje izmjene, brisanje ulaza). */
export function PregledCijenaTabela({ pregled }: { pregled: PregledCijenaUlaza }) {
  return (
    <div className="max-h-[340px] overflow-y-auto space-y-4">
      {pregled.dokumenti.map(d => {
        const v = VRSTA[d.vrsta];
        return (
          <div key={d.brojNivelacije}>
            <p className="flex items-center gap-2 text-[12px] font-semibold text-slate-800">
              <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px]', v.chip)}><v.icon size={11} /> {v.naslov}</span>
              <span className="font-mono text-[11px] text-slate-500">{d.brojNivelacije}</span>
              <span className="text-[11px] font-normal text-slate-400">· {v.opis}</span>
            </p>
            <table className="mt-1 w-full table-fixed text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-[0.14em] text-slate-400 border-b">
                  <th className="text-left py-1.5 font-semibold">Artikal</th>
                  <th className="text-right py-1.5 font-semibold w-14">Zaliha</th>
                  <th className="text-right py-1.5 font-semibold w-20">Stara</th>
                  <th className="text-right py-1.5 font-semibold w-20">Nova</th>
                  <th className="text-right py-1.5 font-semibold w-20">Razlika</th>
                </tr>
              </thead>
              <tbody>
                {d.stavke.map(r => (
                  <tr key={r.productId} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2 text-slate-800 truncate">{r.productNaziv}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-slate-500">{kol(r.kolicina)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-slate-500">{formatKM(r.staraCijena)}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-slate-800">{formatKM(r.novaCijena)}</td>
                    <td className={cn('py-1.5 text-right font-mono tabular-nums font-semibold', razlikaTon(r.ukupnaRazlika))}>{formatKM(r.ukupnaRazlika)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {pregled.bezZalihe.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold text-slate-800">Nova cijena bez nivelacije <span className="text-[11px] font-normal text-slate-400">· nema zalihe</span></p>
          <ul className="mt-1 space-y-0.5">
            {pregled.bezZalihe.map(r => (
              <li key={r.productId} className="flex justify-between gap-2 text-[12px] text-slate-600">
                <span className="truncate">{r.productNaziv}</span>
                <span className="font-mono tabular-nums whitespace-nowrap">{formatKM(r.staraCijena)} → {formatKM(r.novaCijena)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
