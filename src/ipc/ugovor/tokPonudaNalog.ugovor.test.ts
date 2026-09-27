// Ugovor: cijeli tok ponuda → radni nalog → račun → storno i stanje zalihe —
// vidi backend.ts. Ponuda ima jedan proizvod koji se izrađuje po nalogu
// (ormar ×1), jednu stavku preprodaje sa zalihe (sudopera ×2, na stanju 5) i
// uslugu (montaža). Nalog iz ponude izrađuje ormar i troši ploču. Bez obzira
// kojim redom idu završetak naloga, račun i storno, zaliha mora ostati tačna:
// završetak uvodi ormar i troši ploču, račun skida ormar i sudoperu, storno ih
// vraća po zabilježenim kretanjima, a nalog se ne vraća u izradu kad bi
// brisanje ulaza ostavilo stanje u minusu ili kad je ponuda fakturisana.
import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { otvoriBackend, type Backend } from './backend';
import { pokreniPokvareniTring } from './laziTring';
import { scenarij, postoji } from './scenarij';

let b: Backend;
const baza = scenarij(() => b);
let zaustavi: (() => void) | null = null;

beforeEach(async () => { b = await otvoriBackend(); });
afterEach(async () => { zaustavi?.(); zaustavi = null; await b.close(); });

const DATUM = '2026-09-20 11:30:00';

function dodajProizvod(sifra: string, tip: 'artikal' | 'materijal' | 'usluga', cijena: number, stanje = 0): number {
  return baza.artikal({ sifra, naziv: `Proizvod ${sifra}`, cijena, tip, stanje });
}

interface Tok { ponudaId: number; nalogId: number; ormar: number; sudopera: number; ploca: number }

/**
 * Prihvaćena ponuda (ormar ×1, sudopera ×2, montaža ×1) i nalog iz nje koji
 * izrađuje ormar i troši 2 ploče (na stanju 10). Nalog još nije završen.
 */
async function ponudaSNalogom(): Promise<Tok> {
  const kupacId = baza.kupac({ naziv: 'Kupac d.o.o.', idBroj: '4200000000009', adresa: 'Titova 1', postanskiBroj: '71000', grad: 'Sarajevo' });
  const ormar = dodajProizvod('ORM', 'artikal', 400);
  const sudopera = dodajProizvod('SUD', 'artikal', 150, 5);
  const montaza = dodajProizvod('MONT', 'usluga', 100);
  const ploca = dodajProizvod('PL', 'materijal', 50, 10);

  const { id: ponudaId } = await b.pozovi('ponuda:create', {
    kupacId,
    stavke: [
      { productId: ormar, kolicina: 1, cijena: 400, rabat: 0, pdvStopa: 'E' },
      { productId: sudopera, kolicina: 2, cijena: 150, rabat: 0, pdvStopa: 'E' },
      { productId: montaza, kolicina: 1, cijena: 100, rabat: 0, pdvStopa: 'E' },
    ],
  });
  await b.call('ponuda:setStatus', ponudaId, 'prihvacena');
  const { id: nalogId } = await b.pozovi('nalog:createIzPonude', ponudaId, [{ productId: ormar, kolicina: 1 }]);
  await b.call('nalog:replaceStavke', nalogId, [{ materijalId: ploca, kolicina: 2 }]);
  return { ponudaId, nalogId, ormar, sudopera, ploca };
}

const zavrsi = (id: number) => b.pozovi('nalog:setStatus', { id, status: 'zavrsen' });
const vrati = (id: number) => b.pozovi('nalog:setStatus', { id, status: 'vrati' });
const izdaj = (id: number) => b.pozovi('nalog:izdajRacun', { id, nacinPlacanja: 'Virman' });
const storniraj = (id: number) => b.pozovi('order:refundAndPrint', { id });

/** [ormar, sudopera, ploča] */
const zalihe = (t: Tok) => [baza.stanje(t.ormar), baza.stanje(t.sudopera), baza.stanje(t.ploca)];
const nalog = (id: number) => baza.red('SELECT status, racunId FROM radni_nalozi WHERE id = ?', id);
const ponuda = (id: number) => baza.red('SELECT status, racunId FROM ponude WHERE id = ?', id);

describe('ponuda → nalog → račun → storno: zaliha', () => {
  test('A: završen nalog, račun kroz nalog, storno', async () => {
    const t = await ponudaSNalogom();
    expect(zalihe(t)).toEqual([0, 5, 10]);

    await zavrsi(t.nalogId);
    expect(zalihe(t)).toEqual([1, 5, 8]);

    const r = await izdaj(t.nalogId);
    expect(r).toMatchObject({ success: true });
    expect(zalihe(t)).toEqual([0, 3, 8]);
    expect(nalog(t.nalogId)).toEqual({ status: 'fakturisan', racunId: r.racunId });
    expect(ponuda(t.ponudaId)).toEqual({ status: 'konvertovana', racunId: r.racunId });

    expect(await storniraj(postoji(r.racunId))).toMatchObject({ success: true });
    expect(zalihe(t)).toEqual([1, 5, 8]);

    await expect(vrati(t.nalogId)).rejects.toThrow('Nalog je fakturisan i ne može se vratiti u izradu');
    expect(zalihe(t)).toEqual([1, 5, 8]);
  });

  test('B: račun sa ekrana Ponude prije završetka, pa završetak, povezivanje i storno', async () => {
    const t = await ponudaSNalogom();

    const r = await b.pozovi('ponuda:konvertuj', { id: t.ponudaId, nacinPlacanja: 'Virman' });
    expect(r).toMatchObject({ success: true });
    // Ormar je prodan prije nego što je izrađen — negativno stanje ne blokira prodaju.
    expect(zalihe(t)).toEqual([-1, 3, 10]);

    await zavrsi(t.nalogId);
    expect(zalihe(t)).toEqual([0, 3, 8]);

    await expect(vrati(t.nalogId)).rejects.toThrow('Ponuda ovog naloga je već fakturisana — nalog se ne može vratiti u izradu');
    expect(nalog(t.nalogId).status).toBe('zavrsen');
    expect(zalihe(t)).toEqual([0, 3, 8]);

    // "Izdaj račun" na nalogu samo poveže već izdat račun ponude — bez nove štampe.
    const prijeStampe = b.tring.zahtjevi.length;
    const veza = await izdaj(t.nalogId);
    expect(veza).toMatchObject({ success: true, racunId: r.racunId });
    expect(b.tring.zahtjevi.length).toBe(prijeStampe);
    expect(nalog(t.nalogId)).toEqual({ status: 'fakturisan', racunId: r.racunId });
    expect(zalihe(t)).toEqual([0, 3, 8]);

    expect(await storniraj(postoji(r.racunId))).toMatchObject({ success: true });
    expect(zalihe(t)).toEqual([1, 5, 8]);
  });

  test('C: račun kroz nalog s nepoznatim ishodom štampe, resolve, storno', async () => {
    const t = await ponudaSNalogom();
    await zavrsi(t.nalogId);
    expect(zalihe(t)).toEqual([1, 5, 8]);

    const u = await pokreniPokvareniTring('prekid');
    zaustavi = u.stop;
    baza.postavka('tring.host', '127.0.0.1');
    baza.postavka('tring.port', String(u.port));

    const r = await izdaj(t.nalogId);
    expect(r).toMatchObject({ success: false, ishodNepoznat: true });
    expect(zalihe(t)).toEqual([1, 5, 8]);
    expect(nalog(t.nalogId)).toEqual({ status: 'zavrsen', racunId: null });
    await expect(vrati(t.nalogId)).rejects.toThrow('čeka u nezavršenim računima');
    expect(zalihe(t)).toEqual([1, 5, 8]);

    const [pending] = await b.pozovi('pending:list');
    const rijeseno = await b.pozovi('pending:resolve', { id: pending.id, brojFiskalnogRacuna: '777', createdAt: DATUM });
    expect(zalihe(t)).toEqual([0, 3, 8]);
    expect(nalog(t.nalogId)).toEqual({ status: 'fakturisan', racunId: rijeseno.id });
    expect(ponuda(t.ponudaId)).toEqual({ status: 'konvertovana', racunId: rijeseno.id });

    zaustavi(); zaustavi = null;
    baza.postavka('tring.host', 'localhost');
    baza.postavka('tring.port', String(b.tring.port));
    expect(await storniraj(rijeseno.id)).toMatchObject({ success: true });
    expect(zalihe(t)).toEqual([1, 5, 8]);
  });
});
