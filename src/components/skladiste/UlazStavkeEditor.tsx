// src/components/skladiste/UlazStavkeEditor.tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Product } from '@/types';
import { praznaStavka, redStatus, trebaProdajnu, redVrijednost, redNabavnaPoJed, prodajnaPrikaz, prodajnaIzUnosa, redRucPosto, type UlazRed, type Nedostaje } from '@/lib/ulaz';
import { uNetto } from '@/lib/pdvUnos';
import { useUnosBezPdv } from '@/hooks/useUnosBezPdv';
import { jePloca, komUM2 } from '@/lib/ploca';
import { cn, formatKM, parseDecimal } from '@/lib/utils';
import { DecimalInput } from '@/components/ui/decimal-input';
import { Key } from '@/components/ui/ledger';
import { X, Plus } from 'lucide-react';
import { bonusSifreIzabranog } from '@/lib/dobavljacSifre';
import { PretragaProizvoda } from '@/components/PretragaProizvoda';

export interface UlazStavkeHandle {
  /** Doda prazan red (ako zadnji nije već prazan) i stavi fokus na njegovu pretragu. */
  noviRed: () => void;
}

const TH = 'align-bottom text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 pb-2 border-b border-slate-200/80 whitespace-nowrap';
const TD = 'py-1.5 border-b border-slate-100 align-top';
const CELL_INPUT = 'h-8 font-mono text-[12.5px] text-right bg-white';
const MISSING = 'border-amber-300 bg-amber-50/40 focus-visible:ring-amber-400/40';

type Polje = 'artikal' | 'kolicina' | 'nabavna' | 'rabat' | 'prodajna';

/**
 * Redovi ulaza kao tabela u kojoj se kuca: artikal se traži po nazivu/šifri (↑↓ ↵), ↵ vodi
 * na sljedeće polje, a ↵ na zadnjem polju zadnjeg reda otvara novi red. Polja koja fale
 * da bi red bio potpun su označena — zato dugme "Spremi" nikad nije nijemo ugašeno.
 */
export const UlazStavkeEditor = forwardRef<UlazStavkeHandle, {
  rows: UlazRed[]; onChange: (rows: UlazRed[]) => void; products: Product[];
  /** Šifre izabranog dobavljača ulaza (productId → šifra): tačan pogodak ide prvi u pretrazi. */
  sifreDobavljaca?: Map<number, string>;
}>(function UlazStavkeEditor({ rows, onChange, products, sifreDobavljaca }, ref) {
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());
  const pendingFocus = useRef<string | null>(null);
  // Prodajna se kuca sa ili bez PDV-a za cijeli ulaz (jedna faktura = jedan način);
  // početni režim je postavka cijene.unosBezPdv. U redu je cijena uvijek bruto.
  const zadano = useUnosBezPdv();
  const [bezPdv, setBezPdv] = useState(false);
  const primijenjeno = useRef(false);
  const key = (i: number, polje: Polje) => `${i}:${polje}`;
  const reg = (i: number, polje: Polje) => (el: HTMLInputElement | null) => { if (el) inputs.current.set(key(i, polje), el); else inputs.current.delete(key(i, polje)); };
  const focus = (i: number, polje: Polje) => { const el = inputs.current.get(key(i, polje)); el?.focus(); el?.select(); };

  useEffect(() => {
    if (!pendingFocus.current) return;
    const el = inputs.current.get(pendingFocus.current);
    pendingFocus.current = null;
    el?.focus();
  }, [rows]);

  const set = (i: number, patch: Partial<UlazRed>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Prebacivanje samo briše ukucani tekst — polja se ponovo izvedu iz bruto cijene, pa se cijena ne pomjeri.
  const promijeniRezim = (novi: boolean) => {
    if (novi === bezPdv) return;
    setBezPdv(novi);
    if (rows.some(r => r.cijenaUnos != null)) onChange(rows.map(r => ({ ...r, cijenaUnos: undefined })));
  };
  useEffect(() => {
    if (zadano === null || primijenjeno.current) return;
    primijenjeno.current = true;
    promijeniRezim(zadano);
  }, [zadano]);
  const ukloni = (i: number) => onChange(rows.length === 1 ? [praznaStavka()] : rows.filter((_, j) => j !== i));
  const dodajRed = (): number => {
    const zadnji = rows[rows.length - 1];
    if (zadnji && redStatus(zadnji, products).stanje === 'prazan') return rows.length - 1;
    onChange([...rows, praznaStavka()]);
    return rows.length;
  };
  const noviRed = () => { const i = dodajRed(); pendingFocus.current = key(i, 'artikal'); if (i < rows.length) focus(i, 'artikal'); };
  useImperativeHandle(ref, () => ({ noviRed }));

  /** Uz "3*…" količina je već upisana, pa fokus preskače na nabavnu. */
  const odaberi = (i: number, p: Product, kol: number | null) => {
    set(i, {
      productId: p.id, cijena: trebaProdajnu(p) ? String(p.cijena) : '', cijenaUnos: undefined,
      ...(kol != null ? { kolicina: String(kol).replace('.', ',') } : {}),
    });
    pendingFocus.current = key(i, kol != null ? 'nabavna' : 'kolicina');
  };

  const poljaReda = (p: Product | undefined): Polje[] => (trebaProdajnu(p) ? ['kolicina', 'nabavna', 'rabat', 'prodajna'] : ['kolicina', 'nabavna', 'rabat']);

  /** ↵ u polju: sljedeće polje u redu, a sa zadnjeg polja zadnjeg reda — novi red. */
  const onEnter = (i: number, polje: Polje) => {
    const p = products.find(x => x.id === rows[i].productId);
    const polja = poljaReda(p);
    const idx = polja.indexOf(polje);
    if (idx >= 0 && idx < polja.length - 1) return focus(i, polja[idx + 1]);
    if (i < rows.length - 1) return focus(i + 1, rows[i + 1].productId ? 'kolicina' : 'artikal');
    noviRed();
  };

  const bonus = useMemo(() => bonusSifreIzabranog(sifreDobavljaca), [sifreDobavljaca]);

  const fali = (i: number, sta: Nedostaje) => { const s = redStatus(rows[i], products); return s.stanje === 'nepotpun' && s.nedostaje.includes(sta); };

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-separate border-spacing-0 min-w-[720px]">
        <thead>
          <tr>
            <th className={cn(TH, 'text-right w-6 pr-2')}>#</th>
            <th className={cn(TH, 'text-left px-2')}>Artikal</th>
            <th className={cn(TH, 'text-right px-2 w-[118px]')}>Količina</th>
            <th className={cn(TH, 'text-right px-2 w-[108px]')} title="Fakturna cijena bez PDV-a, prije rabata">
              Fakturna
              <span className="block normal-case tracking-normal font-medium text-[10.5px] text-slate-400 mt-0.5">bez PDV-a</span>
            </th>
            <th className={cn(TH, 'text-right px-2 w-[76px]')}>Rabat %</th>
            <th className={cn(TH, 'text-right px-2 w-[120px]')}>
              Prodajna
              <div className="mt-1 inline-flex rounded-md border border-slate-200 bg-white p-0.5 normal-case tracking-normal" role="radiogroup" aria-label="Prodajna cijena se upisuje">
                {([false, true] as const).map(b => (
                  <button key={String(b)} type="button" role="radio" aria-checked={bezPdv === b} onClick={() => promijeniRezim(b)}
                    className={cn('h-5 px-1.5 rounded text-[10.5px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                      bezPdv === b ? 'bg-slate-900 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50')}>
                    {b ? 'bez PDV' : 'sa PDV'}
                  </button>
                ))}
              </div>
            </th>
            <th className={cn(TH, 'text-right px-2 w-[104px] hidden lg:table-cell')} title="Fakturna − rabat; zavisni troškovi dolaze na kraju po stavkama">Nabavna</th>
            <th className={cn(TH, 'w-8')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = products.find(x => x.id === r.productId);
            const kol = parseDecimal(r.kolicina) || 0;
            const rabat = parseDecimal(r.rabat) || 0;
            const prodajna = trebaProdajnu(p);
            const jeMat = !!p && !prodajna;
            return (
              <tr key={i} className="group">
                <td className={cn(TD, 'text-right pr-2 pt-[11px] font-mono text-[10.5px] tabular-nums text-slate-300')}>{i + 1}</td>
                <td className={cn(TD, 'px-2 min-w-[220px]')}>
                  {p ? (
                    <button type="button" onClick={() => { set(i, { productId: null, cijena: '', cijenaUnos: undefined }); pendingFocus.current = key(i, 'artikal'); }}
                      title="Promijeni artikal"
                      className="w-full text-left rounded-md px-2 py-1 -mx-2 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
                      <span className="block text-[12.5px] font-medium text-slate-800 leading-snug">{p.naziv}</span>
                      <span className="block text-[10.5px] font-mono text-slate-400">
                        {p.sifra}
                        {jeMat && <span className="ml-1.5 font-sans font-semibold text-violet-500">materijal</span>}
                        {jePloca(p) && <span className="ml-1.5 font-sans text-slate-400">ploča {p.plocaSirina}×{p.plocaVisina}</span>}
                      </span>
                    </button>
                  ) : (
                    <PretragaProizvoda stavke={products} bonus={bonus} onIzaberi={(p, kol) => odaberi(i, p, kol)}
                      inputRef={reg(i, 'artikal')} velicina="sm" minSirinaListe={560} akcija="izaberi" nedavnoKljuc="ulaz"
                      placeholder="Naziv, šifra, barkod ili šifra dobavljača…" ariaLabel={`Artikal red ${i + 1}`}
                      poljeClassName={cn(fali(i, 'artikal') && 'border-amber-300 bg-amber-50/40')} />
                  )}
                </td>
                <td className={cn(TD, 'px-2')}>
                  <div className="flex items-center justify-end gap-1.5">
                    <DecimalInput ref={reg(i, 'kolicina')} maxDecimals={3} value={r.kolicina} onValueChange={t => set(i, { kolicina: t })}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'kolicina'); } }}
                      placeholder="0" aria-label={`Količina red ${i + 1}`}
                      className={cn(CELL_INPUT, 'w-[72px]', fali(i, 'kolicina') && MISSING)} />
                    <span className="text-[11px] text-slate-400 w-7 truncate">{p ? (jePloca(p) ? 'kom' : p.jm) : ''}</span>
                  </div>
                  {p && jePloca(p) && kol > 0 && (
                    <span className="block text-right pr-[34px] text-[10px] font-mono tabular-nums text-slate-400 mt-0.5">= {komUM2(kol, p.plocaSirina!, p.plocaVisina!)} m²</span>
                  )}
                </td>
                <td className={cn(TD, 'px-2')}>
                  <DecimalInput ref={reg(i, 'nabavna')} value={r.nabavnaCijena} onValueChange={t => set(i, { nabavnaCijena: t })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'nabavna'); } }}
                    placeholder={p && jePloca(p) ? 'po ploči' : '0,00'} aria-label={`Nabavna cijena red ${i + 1}`}
                    className={cn(CELL_INPUT, 'w-full', fali(i, 'nabavna') && MISSING)} />
                </td>
                <td className={cn(TD, 'px-2')}>
                  <DecimalInput ref={reg(i, 'rabat')} value={r.rabat} onValueChange={t => set(i, { rabat: t })}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'rabat'); } }}
                    placeholder="0" aria-label={`Rabat red ${i + 1}`}
                    className={cn(CELL_INPUT, 'w-full')} />
                </td>
                <td className={cn(TD, 'px-2')}>
                  {jeMat ? (
                    <span className="block h-8 leading-8 text-right text-[11px] text-slate-400 pr-1" title="Materijal se ne prodaje na kasi">bez prodajne</span>
                  ) : (
                    <>
                      <DecimalInput ref={reg(i, 'prodajna')} value={prodajnaPrikaz(r, p, bezPdv)} onValueChange={t => set(i, prodajnaIzUnosa(t, p, bezPdv))}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onEnter(i, 'prodajna'); } }}
                        placeholder="0,00" aria-label={`Prodajna cijena ${bezPdv && p?.pdvStopa === 'E' ? 'bez PDV-a' : 'sa PDV-om'} red ${i + 1}`} disabled={!p}
                        className={cn(CELL_INPUT, 'w-full', fali(i, 'prodajna') && MISSING)} />
                      <ProdajnaIspod r={r} p={p} bezPdv={bezPdv} />
                    </>
                  )}
                </td>
                <td className={cn(TD, 'hidden lg:table-cell px-2 text-right pt-[11px] font-mono text-[12px] tabular-nums text-slate-700 whitespace-nowrap')}>
                  {kol > 0 && r.nabavnaCijena ? formatKM(redVrijednost(r)) : <span className="text-slate-300">—</span>}
                  {kol > 0 && r.nabavnaCijena && rabat > 0 && (
                    <span className="block text-[10px] text-slate-400">{formatKM(redNabavnaPoJed(r))} / {p ? (jePloca(p) ? 'kom' : p.jm) : ''}</span>
                  )}
                </td>
                <td className={cn(TD, 'text-right')}>
                  <button type="button" title="Ukloni red" aria-label={`Ukloni red ${i + 1}`} onClick={() => ukloni(i)}
                    className="h-8 w-7 flex items-center justify-center rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"><X size={14} /></button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={noviRed}
        className="mt-2 h-8 flex items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
        <Plus size={13} /> Dodaj red <Key className="ml-0.5">/</Key>
      </button>
    </div>
  );
});

/** Ispod prodajne: iznos u drugoj jedinici i RUC, da se odmah vidi cijena upisana u pogrešnoj jedinici. */
function ProdajnaIspod({ r, p, bezPdv }: { r: UlazRed; p: Product | undefined; bezPdv: boolean }) {
  const bruto = parseDecimal(r.cijena);
  if (!p || r.cijena.trim() === '' || isNaN(bruto)) return null;
  const ruc = redRucPosto(r, p);
  const drugi = p.pdvStopa !== 'E' ? null : bezPdv ? `${formatKM(bruto)} sa PDV` : `${formatKM(uNetto(bruto, 'E'))} bez PDV`;
  return (
    <span className="block text-right pr-1 mt-0.5 text-[10px] font-mono tabular-nums leading-tight">
      {drugi && <span className="block text-slate-500">{drugi}</span>}
      {ruc != null && (
        <span className={cn('block', ruc < 0 ? 'text-rose-600 font-semibold' : 'text-slate-400')} title="Razlika u cijeni na nabavnu nakon rabata, prije zavisnih troškova">
          RUC {ruc.toFixed(1).replace('.', ',')} %
        </span>
      )}
    </span>
  );
}
