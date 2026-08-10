import type { Product, CartItem } from '@/types';

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
