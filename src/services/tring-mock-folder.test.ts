// Folder mod mock TFS-a: stari FoxPro ERP (forma disiz) ne zove HTTP nego upiše
// XML datoteku u C:\TRING\XML\ i čeka odgovor. Fixture je doslovno ono što
// disiz piše: cp1250 (COPY MEMO ... AS 1250), CRLF, ime stampatifiskalniracun.txt.<brkalk>.
import { test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { komandaIzImena, dekodirajCp1250, startMockTringFolder, type MockTringFolder } from '@/services/tring-mock-folder';

let dir: string;
let mock: MockTringFolder | undefined;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tring-xml-'));
});

afterEach(() => {
  mock?.close();
  mock = undefined;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Isto kao disiz: tekst u cp1250 (za ovaj fixture dovoljni su BHS znakovi). */
function cp1250(s: string): Buffer {
  const map: Record<string, number> = { 'č': 0xe8, 'Č': 0xc8, 'ć': 0xe6, 'Ć': 0xc6, 'š': 0x9a, 'Š': 0x8a, 'ž': 0x9e, 'Ž': 0x8e, 'đ': 0xf0, 'Đ': 0xd0 };
  return Buffer.from([...s].map((c) => map[c] ?? c.charCodeAt(0)));
}

const racunDisiz = (brkalk: string, naziv: string) =>
  [
    '<?xml version="1.0" encoding="utf-8" ?>',
    '<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" >',
    `<BrojZahtjeva>${brkalk}</BrojZahtjeva>`,
    '<VrstaZahtjeva>0</VrstaZahtjeva>',
    '<NoviObjekat>',
    '<StavkeRacuna>',
    '<RacunStavka>',
    '<artikal>',
    '<Sifra>00001</Sifra>',
    `<Naziv>${naziv}</Naziv>`,
    '<JM>kom</JM>',
    '<Cijena>12.68</Cijena>',
    '<Stopa>E</Stopa>',
    '</artikal>',
    '<Kolicina>2.0000</Kolicina>',
    '<Rabat>0.00</Rabat>',
    '</RacunStavka>',
    '</StavkeRacuna>',
    '<VrstePlacanja>',
    '<VrstaPlacanja>',
    '<Oznaka>Gotovina</Oznaka>',
    '<Iznos>25.36</Iznos>',
    '</VrstaPlacanja>',
    '</VrstePlacanja>',
    `<BrojRacuna>${brkalk}</BrojRacuna>`,
    '</NoviObjekat>',
    '</RacunZahtjev>',
  ].join('\r\n');

async function cekaj<T>(fn: () => T | undefined, ms = 3000): Promise<T> {
  const kraj = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > kraj) throw new Error('isteklo čekanje');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const procitaj = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : undefined);

test('komanda iz imena datoteke: puni i kratki naziv, sufiksi .txt i broj zahtjeva', () => {
  expect(komandaIzImena('stampatifiskalniracun.txt.251')).toBe('sfr');
  expect(komandaIzImena('StampatiFiskalniRacun.xml')).toBe('sfr');
  expect(komandaIzImena('srr.99687')).toBe('srr');
  expect(komandaIzImena('stampatireklamiraniracun.txt.12')).toBe('srr');
  expect(komandaIzImena('unosnovca.txt')).toBe('un');
  expect(komandaIzImena('Depo.eln')).toBeUndefined();
});

test('cp1250 dekodiranje BHS znakova', () => {
  expect(dekodirajCp1250(cp1250('Čaša šećera, žuto đ'))).toBe('Čaša šećera, žuto đ');
});

test('fiskalni račun iz disiz: odgovor KasaOdgovor u odgovori/ s istim imenom, zahtjev se pokupi', async () => {
  fs.writeFileSync(path.join(dir, 'stampatifiskalniracun.txt.251'), cp1250(racunDisiz('251', '00001 Čaša')));
  mock = startMockTringFolder(dir, { delayMs: 0, tiho: true });

  const odgovor = await cekaj(() => procitaj(path.join(dir, 'odgovori', 'stampatifiskalniracun.txt.251')));
  expect(odgovor).toContain('<KasaOdgovor');
  expect(odgovor).toContain('<VrstaOdgovora>OK</VrstaOdgovora>');
  expect(odgovor).toContain('<BrojZahtjeva>251</BrojZahtjeva>');
  expect(odgovor).toMatch(/<Naziv>BrojFiskalnogRacuna<\/Naziv>\s*<Vrijednost xsi:type="xsd:long">1<\/Vrijednost>/);
  expect(fs.existsSync(path.join(dir, 'stampatifiskalniracun.txt.251'))).toBe(false);
  expect(mock.racuni).toEqual([{ komanda: 'sfr', datoteka: 'stampatifiskalniracun.txt.251', brojFiskalnog: 1, stavke: [{ sifra: '00001', naziv: '00001 Čaša', kolicina: '2.0000', cijena: '12.68' }] }]);
});

test('datoteka koja stigne dok mock radi; brojač fiskalnih računa raste', async () => {
  mock = startMockTringFolder(dir, { delayMs: 0, tiho: true });
  fs.writeFileSync(path.join(dir, 'stampatifiskalniracun.txt.1'), cp1250(racunDisiz('1', 'A')));
  await cekaj(() => procitaj(path.join(dir, 'odgovori', 'stampatifiskalniracun.txt.1')));
  fs.writeFileSync(path.join(dir, 'stampatifiskalniracun.txt.2'), cp1250(racunDisiz('2', 'B')));
  const drugi = await cekaj(() => procitaj(path.join(dir, 'odgovori', 'stampatifiskalniracun.txt.2')));
  expect(drugi).toMatch(/xsd:long">2</);
});

test('zadrziZahtjev: zahtjev ostaje u folderu (za poređenje s ponašanjem pravog TFS-a)', async () => {
  fs.writeFileSync(path.join(dir, 'stampatifiskalniracun.txt.7'), cp1250(racunDisiz('7', 'A')));
  mock = startMockTringFolder(dir, { delayMs: 0, tiho: true, zadrziZahtjev: true });
  await cekaj(() => procitaj(path.join(dir, 'odgovori', 'stampatifiskalniracun.txt.7')));
  expect(fs.existsSync(path.join(dir, 'stampatifiskalniracun.txt.7'))).toBe(true);
  await new Promise((r) => setTimeout(r, 200));
  expect(mock.racuni.length).toBe(1); // zadržan zahtjev se ne obrađuje dvaput
});

test('unosnovca.txt (CASH IN prije reklamacije virmanom) dobije prazan OK odgovor', async () => {
  const xml = '<?xml version="1.0" encoding="utf-8" ?>\r\n<RacunZahtjev><BrojZahtjeva>0</BrojZahtjeva><VrstaZahtjeva>7</VrstaZahtjeva><NoviObjekat><Oznaka>Gotovina</Oznaka><Iznos>10.00</Iznos></NoviObjekat></RacunZahtjev>';
  fs.writeFileSync(path.join(dir, 'unosnovca.txt'), xml);
  mock = startMockTringFolder(dir, { delayMs: 0, tiho: true });
  const odgovor = await cekaj(() => procitaj(path.join(dir, 'odgovori', 'unosnovca.txt')));
  expect(odgovor).toContain('<Odgovori />');
  expect(odgovor).toContain('<VrstaOdgovora>OK</VrstaOdgovora>');
});
