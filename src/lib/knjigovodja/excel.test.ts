import { test, expect } from 'bun:test';
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { napraviExcel } from './excel';
import { zapakuj } from './zip';
import { obracunaj } from './obracun';
import { listoviIzvjestaja } from './listovi';
import type { KnjigovodjaPodaci } from './tipovi';

const FIRMA = { naziv: 'Firma d.o.o.', idBroj: '4200000000000', pdvBroj: '200000000000' };
const IZVEZENO = new Date(2026, 9, 2, 9, 30);

function podaci(): KnjigovodjaPodaci {
  return {
    od: '2026-09-01', do: '2026-09-30',
    racuni: [
      { id: 1, createdAt: '2026-09-02 10:15:00', refundedAt: null, brojFiskalnogRacuna: '1', brojReklamacije: null, status: 'completed', ukupno: 11.7, pdvIznos: 1.7, nacinPlacanja: 'Gotovina', kupacNaziv: null, kupacIdBroj: null, isManual: 0, prilogBroj: null, datumValute: null, korisnikIme: 'A' },
      { id: 2, createdAt: '2026-09-03 11:00:00', refundedAt: null, brojFiskalnogRacuna: '2', brojReklamacije: null, status: 'completed', ukupno: 23.4, pdvIznos: 3.4, nacinPlacanja: 'Kartica', kupacNaziv: 'Kupac', kupacIdBroj: '42', isManual: 0, prilogBroj: null, datumValute: '2026-10-03', korisnikIme: 'A' },
    ],
    reklamacije: [], stavkeRacuna: [], primke: [], primkaStavke: [], nivelacije: [], kretanjaNovca: [], utrosak: [], zalihe: [],
  };
}

async function ucitaj(bajtovi: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  // exceljs tipizira load() kao svoj Buffer (= ArrayBuffer); runtime prima i Uint8Array.
  await wb.xlsx.load(bajtovi.slice().buffer as ArrayBuffer);
  return wb;
}

test('svi listovi kad su moduli uključeni, s zaglavljem firme', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  expect(wb.worksheets.map(w => w.name)).toEqual([
    'Rekapitulacija', 'KIF - računi', 'Reklamacije', 'KUF - ulaz robe', 'Ulaz - stavke', 'Nivelacije',
    'Polog - povrat', 'Utrošak materijala', 'Zalihe na dan', 'Kontrola',
  ]);
  const ws = wb.getWorksheet('KIF - računi')!;
  expect(ws.getCell('A1').value).toBe('Firma d.o.o.');
  expect(String(ws.getCell('A2').value)).toContain('4200000000000');
  expect(String(ws.getCell('A3').value)).toContain('Septembar 2026');
});

test('bez modula nema listova skladišta i proizvodnje', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: false, proizvodnja: false } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  expect(wb.worksheets.map(w => w.name)).toEqual(['Rekapitulacija', 'KIF - računi', 'Reklamacije', 'Polog - povrat', 'Kontrola']);
});

test('KIF: datumi, iznosi i zbirni red s formulom i rezultatom', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: false, proizvodnja: false } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const ws = wb.getWorksheet('KIF - računi')!;
  // Red 5 su naslovi kolona, podaci od reda 6.
  expect(ws.getRow(5).getCell(1).value).toBe('Datum i vrijeme');
  const datum = ws.getRow(6).getCell(1).value as Date;
  expect([datum.getUTCFullYear(), datum.getUTCMonth(), datum.getUTCDate(), datum.getUTCHours(), datum.getUTCMinutes()]).toEqual([2026, 8, 2, 10, 15]);
  const naslovi = (ws.getRow(5).values as any[]).slice(1);
  const kol = (ime: string) => naslovi.indexOf(ime) + 1;
  expect(ws.getRow(6).getCell(kol('Ukupno')).value).toBe(11.7);
  expect(ws.getRow(7).getCell(kol('Osnovica 17%')).value).toBe(20);
  const zbir = ws.getRow(8);
  expect(zbir.getCell(1).value).toBe('Ukupno');
  expect(zbir.getCell(kol('Ukupno')).value).toMatchObject({ result: 35.1 });
  expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 5 });
});

test('prazan period: listovi postoje, zbir 0, Kontrola bez upozorenja', async () => {
  const p = podaci();
  p.racuni = [];
  const iz = obracunaj(p, { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const kif = wb.getWorksheet('KIF - računi')!;
  expect(kif.getRow(6).getCell(1).value).toBe('Ukupno');
  expect(wb.getWorksheet('Kontrola')!.getRow(6).getCell(1).value).toBe('Nema upozorenja');
});

test('listovi u fajlu = listoviIzvjestaja', async () => {
  for (const moduli of [{ skladiste: true, proizvodnja: true }, { skladiste: true, proizvodnja: false }, { skladiste: false, proizvodnja: true }]) {
    const iz = obracunaj(podaci(), { moduli });
    const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
    expect(wb.worksheets.map(w => w.name)).toEqual(listoviIzvjestaja(iz).map(l => l.naziv));
  }
});

test('zip sadrži oba fajla', () => {
  const zip = zapakuj([{ ime: 'a.xlsx', bajtovi: new Uint8Array([1, 2, 3]) }, { ime: 'a.pdf', bajtovi: new TextEncoder().encode('pdf') }]);
  const raspakovano = unzipSync(zip);
  expect(Object.keys(raspakovano).sort()).toEqual(['a.pdf', 'a.xlsx']);
  expect(strFromU8(raspakovano['a.pdf'])).toBe('pdf');
});
