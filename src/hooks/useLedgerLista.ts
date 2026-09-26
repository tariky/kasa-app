import { useRef, useState } from 'react';
import { indeksZaTipku } from '@/lib/ledgerLista';

export interface OpcijeLedgerListe<T> {
  /** ↵ (i razmak) na redu, klik i ↵ van liste: otvori dokument. */
  onOtvori: (id: number) => void;
  /**
   * Izbor koji drži ekran (Ponude: izabrana ponuda puni panel detalja). Bez
   * njega lista sama drži izabrani id.
   */
  izabranId?: number | null;
  onIzaberi?: (stavka: T) => void;
  /** Razmak na redu otvara kao ↵ (zadano: da). */
  razmakOtvara?: boolean;
  /** Fokus na redu ga bira (zadano: da). */
  izborNaFokus?: boolean;
}

export interface LedgerLista<T> {
  stavke: T[];
  izabranId: number | null;
  /** Indeks izabranog reda u `stavke`, -1 kad izabrani nije u listi. */
  izabraniIndeks: number;
  /** Izbor bez fokusa (npr. dokument otvoren iz dijaloga); samo kad lista drži izbor. */
  postaviIzabran: (id: number | null) => void;
  /** Izaberi red i daj mu fokus; `skrol: false` kad je red već na ekranu (klik). */
  fokusRed: (indeks: number, opcije?: { skrol?: boolean }) => void;
  /** Izaberi i otvori dokument. */
  otvori: (id: number) => void;
  rowProps: (indeks: number) => {
    ref: (el: HTMLTableRowElement | null) => void;
    tabIndex: number;
    'aria-selected': boolean;
    onFocus?: () => void;
  };
  onTbodyKeyDown: (e: React.KeyboardEvent<HTMLTableSectionElement>) => void;
  /** Po zatvaranju dijaloga fokus se vraća na izabrani red da ↑↓ odmah rade dalje. */
  vratiFokus: () => void;
}

/**
 * Tastatura ledger liste: ↑↓, PageUp/PageDown, Home/End biraju red i drže fokus
 * na njemu, ↵ (i razmak) otvara izabrani dokument. Tipka van liste (↓ u listu, ↵,
 * „/“, N…) je posao `usePreciceListe`.
 */
export function useLedgerLista<T extends { id: number }>(stavke: T[], opcije: OpcijeLedgerListe<T>): LedgerLista<T> {
  const [vlastitiId, setVlastitiId] = useState<number | null>(null);
  const redovi = useRef<(HTMLTableRowElement | null)[]>([]);
  const kontrolisan = opcije.izabranId !== undefined;
  const izabranId = kontrolisan ? opcije.izabranId ?? null : vlastitiId;
  const izabraniIndeks = stavke.findIndex(s => s.id === izabranId);

  const izaberi = (s: T) => {
    if (kontrolisan) opcije.onIzaberi?.(s);
    else setVlastitiId(s.id);
  };

  const fokusRed = (indeks: number, o?: { skrol?: boolean }) => {
    const s = stavke[indeks];
    if (!s) return;
    izaberi(s);
    const el = redovi.current[indeks];
    el?.focus();
    if (o?.skrol ?? true) el?.scrollIntoView({ block: 'nearest' });
  };

  const otvori = (id: number) => {
    if (!kontrolisan) setVlastitiId(id);
    opcije.onOtvori(id);
  };

  const onTbodyKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const i = indeksZaTipku(e.key, izabraniIndeks, stavke.length);
    if (i != null) { e.preventDefault(); fokusRed(i); return; }
    if (e.key === 'Enter' || (e.key === ' ' && (opcije.razmakOtvara ?? true))) {
      if (izabranId != null) { e.preventDefault(); otvori(izabranId); }
    }
  };

  const rowProps = (indeks: number) => {
    const s = stavke[indeks];
    const izabran = izabranId === s?.id;
    return {
      ref: (el: HTMLTableRowElement | null) => { redovi.current[indeks] = el; },
      tabIndex: izabran || (izabraniIndeks < 0 && indeks === 0) ? 0 : -1,
      'aria-selected': izabran,
      ...((opcije.izborNaFokus ?? true) ? { onFocus: () => izaberi(s) } : {}),
    };
  };

  const vratiFokus = () => {
    requestAnimationFrame(() => {
      const i = stavke.findIndex(s => s.id === izabranId);
      if (i >= 0) redovi.current[i]?.focus();
    });
  };

  return {
    stavke, izabranId, izabraniIndeks, postaviIzabran: setVlastitiId, fokusRed, otvori, rowProps, onTbodyKeyDown, vratiFokus,
  };
}
