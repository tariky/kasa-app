// Pravila za korisnike (user:create / user:update / user:delete) — na jednom mjestu.

export const ULOGE = ['admin', 'kasir'] as const;
export type Uloga = (typeof ULOGE)[number];

/** Baca grešku ako PIN nije niz od najmanje 4 cifre; vraća PIN nepromijenjen. */
export function validirajPin(pin: unknown): string {
  if (pin == null || (typeof pin === 'string' && !pin.trim())) throw new Error('PIN je obavezan');
  if (typeof pin !== 'string' || !/^\d+$/.test(pin)) throw new Error('PIN smije sadržavati samo cifre');
  if (pin.length < 4) throw new Error('PIN mora imati najmanje 4 cifre');
  return pin;
}

/** Baca grešku ako uloga nije "admin" ili "kasir". */
export function validirajUlogu(uloga: unknown): Uloga {
  if (!(ULOGE as readonly unknown[]).includes(uloga)) throw new Error('Uloga mora biti "admin" ili "kasir"');
  return uloga as Uloga;
}

/** Tabele s FK na users(id) — korisnik s ijednim redom u njima ne može biti obrisan. */
export const VEZE_KORISNIKA: readonly { tabela: string; poruka: string }[] = [
  { tabela: 'orders', poruka: 'Korisnik ima račune i ne može biti obrisan' },
  { tabela: 'pending_receipts', poruka: 'Korisnik ima račun u obradi i ne može biti obrisan' },
  { tabela: 'cash_movements', poruka: 'Korisnik ima pologe/povrate gotovine i ne može biti obrisan' },
  { tabela: 'ponude', poruka: 'Korisnik ima ponude i ne može biti obrisan' },
  { tabela: 'radni_nalozi', poruka: 'Korisnik ima radne naloge i ne može biti obrisan' },
];
