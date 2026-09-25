import type { Product, CartItem } from '@/types';
import { formatKM } from './utils';

/** Stavka spremljene košarice kako se čuva u saved_carts.items (JSON). */
export interface SavedCartItem {
  productId: number;
  kolicina: number;
  rabat: number;
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
  const skipStock = product.tip === 'usluga' || allowZeroStock;
  const addQty = skipStock ? qty : Math.min(qty, (product.stanje ?? 0) - currentQty);
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
 * Dodaje slobodnu stavku (usluga, bez zalihe). Isti naziv, stopa i JM uvijek
 * daju isti artikal, pa ponovni unos po istoj cijeni samo uvećava količinu.
 * Po drugoj cijeni se odbija: red koji je već na računu ne smije tiho
 * promijeniti cijenu, a isti artikal ne može na račun po dvije cijene.
 */
export function dodajSlobodnuStavku(
  cart: CartItem[],
  product: Product,
  qty: number
): { cart: CartItem[]; greska?: string } {
  const postojeca = cart.find(item => item.product.id === product.id);
  if (postojeca && postojeca.product.cijena !== product.cijena) {
    return {
      cart,
      greska: `„${postojeca.product.naziv}“ je već na računu po cijeni ${formatKM(postojeca.product.cijena)}. Promijenite naziv ili uklonite postojeću stavku.`,
    };
  }
  return { cart: dodajUKosaricu(cart, product, qty, true) };
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
    const skipStock = item.product.tip === 'usluga' || allowZeroStock;
    const kolicina = skipStock ? qty : Math.min(qty, item.product.stanje ?? 0);
    return kolicina > 0 ? { ...item, kolicina } : item;
  });
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
    const skipStock = product.tip === 'usluga' || allowZeroStock;
    if (skipStock) {
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
