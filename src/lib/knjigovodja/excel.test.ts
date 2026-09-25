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
  // Jedan prazan red između podataka i „Ukupno“ — sort/filter ga ne dira.
  expect(ws.getRow(8).getCell(1).value).toBeNull();
  const zbir = ws.getRow(9);
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
  expect(kif.getRow(6).getCell(1).value).toBeNull();
  expect(kif.getRow(7).getCell(1).value).toBe('Ukupno');
  expect(kif.autoFilter).toBe('A5:K5');
  expect(wb.getWorksheet('Kontrola')!.getRow(6).getCell(1).value).toBe('Nema upozorenja');
});

/** Pun mjesec: više računa, reklamacija, primke, nivelacija, utrošak, polog/povrat i zaliha u minusu. */
function puniPodaci(): KnjigovodjaPodaci {
  const p = podaci();
  const r = p.racuni[0];
  p.racuni.push(
    { ...r, id: 3, createdAt: '2026-09-03 18:20:00', brojFiskalnogRacuna: '3', ukupno: 7.35, pdvIznos: 1.07, nacinPlacanja: JSON.stringify({ gotovina: 5, kartica: 2.35 }) },
    { ...r, id: 4, createdAt: '2026-09-10 09:05:00', brojFiskalnogRacuna: '4', ukupno: 0.1, pdvIznos: 0.01, nacinPlacanja: 'Virman' },
  );
  p.reklamacije = [{ ...r, id: 9, createdAt: '2026-08-28 10:00:00', refundedAt: '2026-09-04 12:00:00', brojFiskalnogRacuna: '9', brojReklamacije: 'R-1', status: 'refunded', ukupno: 4.2, pdvIznos: 0.61 }];
  p.primke = [
    { id: 1, brojPrimke: 'U-1', datum: '2026-09-05', dobavljacNaziv: 'Dob', dobavljacId: '42', brojFakture: 'F-1' },
    { id: 2, brojPrimke: 'U-2', datum: '2026-09-12', dobavljacNaziv: 'Dob 2', dobavljacId: '43', brojFakture: 'F-2' },
  ];
  p.primkaStavke = [
    { primkaId: 1, sifra: 'A', naziv: 'Art', jm: 'kom', kolicina: 10, cijena: 11.7, nabavnaCijena: 5.13, rabat: 10, zavisniTroskovi: 1.2, pdvStopa: 'E' },
    { primkaId: 2, sifra: 'M', naziv: 'Mat', jm: 'm', kolicina: 2.5, cijena: 0, nabavnaCijena: 3.33, rabat: 0, zavisniTroskovi: 0, pdvStopa: 'E' },
    { primkaId: 2, sifra: 'B', naziv: 'Bez', jm: 'kom', kolicina: 3, cijena: 2.4, nabavnaCijena: 1.1, rabat: 0, zavisniTroskovi: 0.3, pdvStopa: 'K' },
  ];
  p.nivelacije = [{ brojNivelacije: 'N-1', datum: '2026-09-15', sifra: 'A', naziv: 'Art', kolicina: 4, staraCijena: 11.7, novaCijena: 12.3, razlika: 0.6, ukupnaRazlika: 2.4, pdvStopa: 'E' }];
  p.kretanjaNovca = [
    { createdAt: '2026-09-01 07:00:00', tip: 'polog', iznos: 50, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
    { createdAt: '2026-09-01 20:00:00', tip: 'povrat', iznos: 20.1, korisnikIme: 'A', napomena: null, tringStatus: 'ok' },
    { createdAt: '2026-09-02 07:00:00', tip: 'polog', iznos: 50.2, korisnikIme: 'A', napomena: 'jutro', tringStatus: 'skipped' },
  ];
  const u = { broj: 1, godina: 2026, zavrsenAt: '2026-09-06 10:00:00', opis: 'N', proizvod: 'P', sifra: 'M', naziv: 'Mat', jm: 'm' };
  p.utrosak = [
    { nalogId: 1, ...u, kolicina: 1.25, nabavnaCijena: 3.33, prosjecnaNabavna: 3 },
    { nalogId: 2, ...u, broj: 2, kolicina: 2, nabavnaCijena: null, prosjecnaNabavna: 3.1 },
  ];
  p.zalihe = [
    { sifra: 'A', naziv: 'Art', jm: 'kom', tip: 'artikal', kolicina: 7, cijena: 12.3, nabavnaVrijednost: 47.37, nabavnaKolicina: 10 },
    { sifra: 'C', naziv: 'Minus', jm: 'kom', tip: 'artikal', kolicina: -2, cijena: 5, nabavnaVrijednost: 9, nabavnaKolicina: 3 },
    { sifra: 'M', naziv: 'Mat', jm: 'm', tip: 'materijal', kolicina: 0.75, cijena: 0, nabavnaVrijednost: 8.33, nabavnaKolicina: 2.5 },
  ];
  return p;
}

const naslovi = (ws: ExcelJS.Worksheet) => (ws.getRow(5).values as any[]).slice(1);
/** Prvi red „Ukupno…“ ispod naslova (red 5). */
function redZbira(ws: ExcelJS.Worksheet): number {
  for (let r = 6; r <= ws.rowCount; r++) if (String(ws.getRow(r).getCell(1).value ?? '').startsWith('Ukupno')) return r;
  throw new Error(`${ws.name}: nema reda Ukupno`);
}
function zbirKolone(ws: ExcelJS.Worksheet, naslov: string, red = redZbira(ws)) {
  const i = naslovi(ws).indexOf(naslov);
  if (i < 0) throw new Error(`${ws.name}: nema kolone ${naslov}`);
  return ws.getRow(red).getCell(i + 1).value as { formula: string; result: number };
}

test('zbir u Excelu = zbir iz obracunaj na svakom listu (i sa zalihom u minusu)', async () => {
  const iz = obracunaj(puniPodaci(), { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const ws = (ime: string) => wb.getWorksheet(ime)!;
  const z = iz.zbir;

  expect(zbirKolone(ws('Rekapitulacija'), 'Broj računa').result).toBe(z.promet.brojRacuna);
  expect(zbirKolone(ws('Rekapitulacija'), 'Ukupno').result).toBe(z.promet.ukupno);
  expect(zbirKolone(ws('Rekapitulacija'), 'Neto').result).toBe(z.neto);
  expect(zbirKolone(ws('KIF - računi'), 'Ukupno').result).toBe(z.promet.ukupno);
  expect(zbirKolone(ws('KIF - računi'), 'PDV 17%').result).toBe(z.promet.pdvE);
  expect(zbirKolone(ws('Reklamacije'), 'Ukupno').result).toBe(z.reklamacije.ukupno);
  expect(zbirKolone(ws('KUF - ulaz robe'), 'Nabavna vrijednost').result).toBe(z.ulaz.nabavna);
  expect(zbirKolone(ws('KUF - ulaz robe'), 'PDV').result).toBe(z.ulaz.pdv);
  expect(zbirKolone(ws('KUF - ulaz robe'), 'Prodajna vrijednost').result).toBe(z.ulaz.prodajna);
  expect(zbirKolone(ws('Nivelacije'), 'Ukupna razlika').result).toBe(z.nivelacijeRazlika);
  expect(zbirKolone(ws('Utrošak materijala'), 'Vrijednost').result).toBe(z.utrosak.vrijednost);
  expect(zbirKolone(ws('Polog - povrat'), 'Polog').result).toBe(z.polozi);
  expect(zbirKolone(ws('Polog - povrat'), 'Povrat').result).toBe(z.povrati);

  // Zalihe: zbir samo pozitivnih količina, kao na ekranu i u PDF-u.
  expect(iz.zalihe.some(r => r.kolicina < 0)).toBe(true);
  const zal = ws('Zalihe na dan');
  const red = redZbira(zal);
  expect(zal.getRow(red).getCell(1).value).toBe('Ukupno (bez minusa)');
  const nabavna = zbirKolone(zal, 'Nabavna vrijednost');
  const prodajna = zbirKolone(zal, 'Prodajna vrijednost');
  expect(nabavna).toEqual({ formula: `SUMIF(E6:E8,">0",G6:G8)`, result: z.zalihe.nabavna });
  expect(prodajna).toEqual({ formula: `SUMIF(E6:E8,">0",I6:I8)`, result: z.zalihe.prodajna });
});

test('Ukupno je iza jednog praznog reda, autofilter pokriva samo podatke', async () => {
  const iz = obracunaj(puniPodaci(), { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const redova: Record<string, number> = {
    'Rekapitulacija': iz.dani.length, 'KIF - računi': iz.kif.length, 'Reklamacije': iz.reklamacije.length,
    'KUF - ulaz robe': iz.kuf.length, 'Nivelacije': iz.nivelacije.length, 'Polog - povrat': iz.kretanjaNovca.length,
    'Utrošak materijala': iz.utrosak.length, 'Zalihe na dan': iz.zalihe.length,
  };
  for (const [ime, n] of Object.entries(redova)) {
    const ws = wb.getWorksheet(ime)!;
    const zadnji = 5 + n;
    const zadnjaKolona = ws.getColumn(naslovi(ws).length).letter;
    expect([ime, ws.autoFilter]).toEqual([ime, `A5:${zadnjaKolona}${zadnji}`]);
    expect([ime, ws.getRow(zadnji + 1).cellCount]).toEqual([ime, 0]);
    expect([ime, redZbira(ws)]).toEqual([ime, zadnji + 2]);
    const formule: string[] = [];
    ws.getRow(zadnji + 2).eachCell(c => { const f = (c.value as any)?.formula; if (f) formule.push(f); });
    expect([ime, formule.length > 0]).toEqual([ime, true]);
    for (const f of formule) expect([ime, f]).toEqual([ime, expect.stringMatching(new RegExp(`^SUM(IF)?\\([A-Z]+6:[A-Z]+${zadnji}[,)]`))]);
  }

  // Utrošak: druga tabela ispod prve, s istim rasporedom i istim zbirom.
  const ut = wb.getWorksheet('Utrošak materijala')!;
  const ukupno1 = redZbira(ut);
  expect(ut.getRow(ukupno1 + 1).cellCount).toBe(0);
  expect(ut.getRow(ukupno1 + 2).getCell(1).value).toBe('Zbir po materijalu');
  const naslovi2 = ukupno1 + 3;
  expect(ut.getRow(naslovi2).getCell(1).value).toBe('Šifra');
  const zadnji2 = naslovi2 + iz.utrosakZbir.length;
  expect(ut.getRow(zadnji2 + 1).cellCount).toBe(0);
  expect(ut.getRow(zadnji2 + 2).getCell(1).value).toBe('Ukupno');
  expect(ut.getRow(zadnji2 + 2).getCell(5).value).toEqual({ formula: `SUM(E${naslovi2 + 1}:E${zadnji2})`, result: iz.zbir.utrosak.vrijednost });

  // Kontrola nema zbira; autofilter do zadnjeg upozorenja.
  const k = wb.getWorksheet('Kontrola')!;
  expect(k.autoFilter).toBe(`A5:B${5 + iz.upozorenja.length}`);
});

test('format broja: cijeli brojevi bez decimalne tačke, razlomci do 3 decimale', async () => {
  const iz = obracunaj(puniPodaci(), { moduli: { skladiste: true, proizvodnja: true } });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  const rek = wb.getWorksheet('Rekapitulacija')!;
  expect(rek.getRow(6).getCell(2).numFmt).toBe('#,##0');
  expect(zbirKolone(rek, 'Broj računa')).toMatchObject({ result: 4 });
  expect(rek.getRow(redZbira(rek)).getCell(2).numFmt).toBe('#,##0');

  const st = wb.getWorksheet('Ulaz - stavke')!;
  const kol = naslovi(st).indexOf('Količina') + 1;
  const rabat = naslovi(st).indexOf('Rabat %') + 1;
  expect(st.getRow(6).getCell(kol).value).toBe(10);
  expect(st.getRow(6).getCell(kol).numFmt).toBe('#,##0');
  expect(st.getRow(7).getCell(kol).value).toBe(2.5);
  expect(st.getRow(7).getCell(kol).numFmt).toBe('#,##0.###');
  expect(st.getRow(6).getCell(rabat).numFmt).toBe('#,##0');

  const zal = wb.getWorksheet('Zalihe na dan')!;
  expect(zal.getRow(8).getCell(5).value).toBe(0.75);
  expect(zal.getRow(8).getCell(5).numFmt).toBe('#,##0.###');
  expect(zal.getRow(7).getCell(5).numFmt).toBe('#,##0');
});

test('Kontrola: period koji još traje ima svoj naziv', async () => {
  const iz = obracunaj(podaci(), { moduli: { skladiste: false, proizvodnja: false }, danas: '2026-09-25' });
  const wb = await ucitaj(await napraviExcel(iz, FIRMA, IZVEZENO));
  expect(wb.getWorksheet('Kontrola')!.getRow(6).getCell(1).value).toBe('Period još traje');
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
