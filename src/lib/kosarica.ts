import type { Product, CartItem } from '@/types';
import { formatKM, formatKolicina } from './utils';

/** Stavka spremljene košarice kako se čuva u saved_carts.items (JSON). */
export interface SavedCartItem {
  productId: number;
  kolicina: number;
  rabat: number;
}

/** Usluga nema zalihu, a allowZeroStock dopušta prodaju preko stanja — tada se stanje ne gleda. */
function bezZalihe(product: Product, allowZeroStock: boolean): boolean {
  return product.tip === 'usluga' || allowZeroStock;
}

/**
 * Dodaje artikal u košaricu poštujući zalihe: bez allowZeroStock ukupna
 * količina artikla ne može preći stanje (usluge nemaju zalihu).
 */
export function dodajUKosaricu(
  cart: CartItem[],
  product: Product,
  qty: number,
  allowZeroStock: boolean
): CartItem[] {
  if (qty <= 0) return cart;
  const existing = cart.find(item => item.product.id === product.id);
  const currentQty = existing ? existing.kolicina : 0;
  const addQty = bezZalihe(product, allowZeroStock) ? qty : Math.min(qty, (product.stanje ?? 0) - currentQty);
  if (addQty <= 0) return cart;
  if (existing) {
    return cart.map(item =>
      item.product.id === product.id
        ? { ...item, kolicina: item.kolicina + addQty }
        : item
    );
  }
  return [...cart, { product, kolicina: addQty, rabat: 0 }];
}

/**
 * Izbor artikla na kasi: dodaje koliko stanje dozvoljava, stavka koja tek ulazi
 * dobija rabat kupca, a `upozorenje` kaže kasiru kad nije ušlo sve što je tražio.
 */
export function dodaj(
  cart: CartItem[],
  product: Product,
  qty: number,
  { allowZeroStock, rabatKupca }: { allowZeroStock: boolean; rabatKupca: number }
): { cart: CartItem[]; dodano: number; upozorenje: string | null } {
  const prije = cart.find(i => i.product.id === product.id)?.kolicina ?? 0;
  const next = dodajUKosaricu(cart, product, qty, allowZeroStock);
  const saRabatom = prije === 0 && rabatKupca > 0 ? postaviRabat(next, product.id, rabatKupca) : next;
  const dodano = (saRabatom.find(i => i.product.id === product.id)?.kolicina ?? 0) - prije;
  const upozorenje = dodano < qty
    ? dodano === 0
      ? `„${product.naziv}“: nema više na stanju.`
      : `„${product.naziv}“: na stanju je ${formatKolicina(product.stanje ?? 0)} ${product.jm || 'kom'}, dodano ${formatKolicina(dodano)}.`
    : null;
  return { cart: saRabatom, dodano, upozorenje };
}

/**
 * Dodaje slobodnu stavku (usluga, bez zalihe). Isti naziv, stopa i JM uvijek
 * daju isti artikal, pa ponovni unos po istoj cijeni samo uvećava količinu.
 * Po drugoj cijeni se odbija: red koji je već na računu ne smije tiho
 * promijeniti cijenu, a isti artikal ne može na račun po dvije cijene.
 */
export function dodajSlobodnuStavku(
  cart: CartItem[],
  product: Product,
  qty: number,
  rabatKupca = 0
): { cart: CartItem[]; greska?: string } {
  const postojeca = cart.find(item => item.product.id === product.id);
  if (postojeca && postojeca.product.cijena !== product.cijena) {
    return {
      cart,
      greska: `„${postojeca.product.naziv}“ je već na računu po cijeni ${formatKM(postojeca.product.cijena)}. Promijenite naziv ili uklonite postojeću stavku.`,
    };
  }
  return { cart: dodaj(cart, product, qty, { allowZeroStock: true, rabatKupca }).cart };
}

/**
 * Postavlja tačnu količinu stavke (npr. ispravka u redu računa). Bez allowZeroStock
 * količina artikla se steže na stanje; 0 ili manje uklanja stavku.
 */
export function postaviKolicinu(
  cart: CartItem[],
  productId: number,
  qty: number,
  allowZeroStock: boolean
): CartItem[] {
  if (qty <= 0) return cart.filter(item => item.product.id !== productId);
  return cart.map(item => {
    if (item.product.id !== productId) return item;
    const kolicina = bezZalihe(item.product, allowZeroStock) ? qty : Math.min(qty, item.product.stanje ?? 0);
    return kolicina > 0 ? { ...item, kolicina } : item;
  });
}

/**
 * Korak + ili − na redu računa. Korak preko stanja se ne radi — red ostaje
 * kakav jeste, i kad do stanja fali manje od koraka (2 od 2,5 kg ostaje 2);
 * pad na nulu uklanja stavku.
 */
export function pomjeriKolicinu(
  cart: CartItem[],
  productId: number,
  delta: number,
  allowZeroStock: boolean
): CartItem[] {
  const item = cart.find(i => i.product.id === productId);
  if (!item) return cart;
  const nova = item.kolicina + delta;
  if (delta > 0 && !bezZalihe(item.product, allowZeroStock) && nova > (item.product.stanje ?? 0)) return cart;
  return postaviKolicinu(cart, productId, nova, allowZeroStock);
}

/** Bosanski plural za "stavka": 1 stavka, 2–4 stavke, 5+ stavki (21 stavka, 12 stavki). */
export function stavkeTekst(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} stavka`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} stavke`;
  return `${n} stavki`;
}

/** Rabat je postotak — sve van 0–100 se steže na granice. */
function clampRabat(rabat: number): number {
  return Math.min(100, Math.max(0, rabat));
}

export function postaviRabat(cart: CartItem[], productId: number, rabat: number): CartItem[] {
  return cart.map(item =>
    item.product.id === productId ? { ...item, rabat: clampRabat(rabat) } : item
  );
}

export function postaviRabatNaSve(cart: CartItem[], rabat: number): CartItem[] {
  return cart.map(item => ({ ...item, rabat: clampRabat(rabat) }));
}

/**
 * Vraća spremljenu košaricu uz svježe podatke iz šifarnika: obrisani artikli
 * se preskaču, a bez allowZeroStock količina se sreže na dostupno stanje
 * (stavka sa stanjem 0 se izbacuje). Svaki problem ide u `upozorenja`.
 */
export function restoreCart(
  items: SavedCartItem[],
  lookup: (productId: number) => Product | undefined,
  allowZeroStock: boolean
): { cart: CartItem[]; upozorenja: string[] } {
  const cart: CartItem[] = [];
  const upozorenja: string[] = [];

  for (const item of items) {
    const product = lookup(item.productId);
    if (!product) {
      upozorenja.push(`Artikal (ID ${item.productId}) više ne postoji — izostavljen.`);
      continue;
    }
    if (bezZalihe(product, allowZeroStock)) {
      cart.push({ product, kolicina: item.kolicina, rabat: item.rabat });
      continue;
    }
    const stanje = product.stanje ?? 0;
    if (stanje <= 0) {
      upozorenja.push(`${product.naziv}: nema na stanju — izostavljen.`);
      continue;
    }
    if (item.kolicina > stanje) {
      upozorenja.push(`${product.naziv}: traženo ${item.kolicina}, dostupno ${stanje} — količina smanjena.`);
      cart.push({ product, kolicina: stanje, rabat: item.rabat });
      continue;
    }
    cart.push({ product, kolicina: item.kolicina, rabat: item.rabat });
  }

  return { cart, upozorenja };
}
