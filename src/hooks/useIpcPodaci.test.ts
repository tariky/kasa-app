import { test, expect, describe } from 'bun:test';
import { redUcitavanja, POCETNO_STANJE, type StanjePodataka } from './useIpcPodaci';

/** Obećanje koje test sam razrješava — redoslijed odgovora je pod kontrolom testa. */
function odgodjeno<T>() {
  let razrijesi!: (v: T) => void;
  let odbij!: (e: unknown) => void;
  const obecanje = new Promise<T>((a, b) => { razrijesi = a; odbij = b; });
  return { obecanje, razrijesi, odbij };
}

function napravi<T>() {
  const drzac = { stanje: POCETNO_STANJE as StanjePodataka<T> };
  const red = redUcitavanja<T>(p => { drzac.stanje = p(drzac.stanje); });
  return { drzac, red };
}

describe('redUcitavanja', () => {
  test('uspjeh: podaci stižu, učitavanje završeno, nema greške', async () => {
    const { drzac, red } = napravi<number[]>();
    expect(drzac.stanje).toEqual({ podaci: undefined, greska: null, ucitava: true });
    await red.ucitaj(async () => [1, 2]);
    expect(drzac.stanje).toEqual({ podaci: [1, 2], greska: null, ucitava: false });
  });

  test('dok zahtjev traje, ucitava je true, a stari podaci ostaju', async () => {
    const { drzac, red } = napravi<string>();
    await red.ucitaj(async () => 'prvo');
    const d = odgodjeno<string>();
    const tok = red.ucitaj(() => d.obecanje);
    expect(drzac.stanje).toEqual({ podaci: 'prvo', greska: null, ucitava: true });
    d.razrijesi('drugo');
    await tok;
    expect(drzac.stanje).toEqual({ podaci: 'drugo', greska: null, ucitava: false });
  });

  test('greška ide kroz porukaGreske (bez Electron prefiksa), stari podaci ostaju', async () => {
    const { drzac, red } = napravi<string>();
    await red.ucitaj(async () => 'lista');
    await red.ucitaj(async () => {
      throw new Error("Error invoking remote method 'kupci:getAll': Error: Baza je zaključana");
    });
    expect(drzac.stanje).toEqual({ podaci: 'lista', greska: 'Baza je zaključana', ucitava: false });
  });

  test('sinhrono bačena greška je ista kao odbijeno obećanje', async () => {
    const { drzac, red } = napravi<string>();
    await red.ucitaj(() => { throw new Error('nema api-ja'); });
    expect(drzac.stanje).toEqual({ podaci: undefined, greska: 'nema api-ja', ucitava: false });
  });

  test('uspješno ponovno učitavanje briše grešku', async () => {
    const { drzac, red } = napravi<number>();
    await red.ucitaj(() => Promise.reject(new Error('pad')));
    expect(drzac.stanje.greska).toBe('pad');
    await red.ucitaj(async () => 7);
    expect(drzac.stanje).toEqual({ podaci: 7, greska: null, ucitava: false });
  });

  test('zastario odgovor koji stigne poslije novijeg se odbacuje', async () => {
    const { drzac, red } = napravi<string>();
    const stari = odgodjeno<string>();
    const novi = odgodjeno<string>();
    const t1 = red.ucitaj(() => stari.obecanje);
    const t2 = red.ucitaj(() => novi.obecanje);
    novi.razrijesi('novi');
    await t2;
    stari.razrijesi('stari');
    await t1;
    expect(drzac.stanje).toEqual({ podaci: 'novi', greska: null, ucitava: false });
  });

  test('zastarjela greška ne prepisuje novije podatke', async () => {
    const { drzac, red } = napravi<string>();
    const stari = odgodjeno<string>();
    const t1 = red.ucitaj(() => stari.obecanje);
    await red.ucitaj(async () => 'novi');
    stari.odbij(new Error('kasni pad'));
    await t1;
    expect(drzac.stanje).toEqual({ podaci: 'novi', greska: null, ucitava: false });
  });

  test('poslije otkazi() odgovor se ne upisuje (StrictMode: effect se očisti pa ponovi)', async () => {
    const { drzac, red } = napravi<string>();
    const prvi = odgodjeno<string>();
    const t1 = red.ucitaj(() => prvi.obecanje);
    red.otkazi();
    const t2 = red.ucitaj(async () => 'drugi mount');
    await t2;
    prvi.razrijesi('prvi mount');
    await t1;
    expect(drzac.stanje).toEqual({ podaci: 'drugi mount', greska: null, ucitava: false });
  });

  test('ucitaj() nikad ne odbija — pozivalac može await bez try/catch', async () => {
    const { red } = napravi<string>();
    await expect(red.ucitaj(() => Promise.reject(new Error('x')))).resolves.toBeUndefined();
  });
});
