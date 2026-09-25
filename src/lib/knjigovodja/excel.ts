// Excel za knjigovođu: po jedan list za svaku cjelinu izvještaja. Brojevi
// dolaze gotovi iz obracun.ts; ovdje je samo raspored i format.
import ExcelJS from 'exceljs';
import type { FirmaSettings } from '@/types';
import { prikazPerioda } from './period';
import { NAZIVI_LISTOVA } from './listovi';
import type { KnjigovodjaIzvjestaj, VrstaUpozorenja } from './obracun';

type Format = 'km' | 'datum' | 'datumVrijeme' | 'kolicina' | 'cijena' | 'broj';
type Celija = string | number | Date | null;

/** Zbir kolone koji nije običan SUM; `raspon('Naslov')` → npr. 'E6:E9'. */
interface PosebanZbir {
  formula: (raspon: (naslov: string) => string) => string;
  /** Keširan rezultat — broj iz obracun.ts, da Excel, PDF i ekran budu isti. */
  rezultat: number;
}

interface Kolona<T> {
  naslov: string;
  sirina: number;
  v: (r: T) => Celija;
  format?: Format;
  /** Kolona dobija zbir u redu „Ukupno“: SUM kolone ili poseban zbir. */
  zbir?: boolean | PosebanZbir;
}

const FORMATI: Record<Format, string> = {
  km: '#,##0.00',
  cijena: '#,##0.00##',
  kolicina: '#,##0.###',
  broj: '#,##0',
  datum: 'dd.mm.yyyy',
  datumVrijeme: 'dd.mm.yyyy hh:mm',
};

/** Količina/procenat: cijeli broj bez decimalne tačke („1“, ne „1.“). */
function numFmt(format: Format, v: unknown): string {
  if (format === 'kolicina' && typeof v === 'number' && Number.isInteger(v)) return FORMATI.broj;
  return FORMATI[format];
}

const PRVI_RED_PODATAKA = 6;

/** 'YYYY-MM-DD[ HH:MM:SS]' → Date koji Excel prikaže tačno tako (exceljs piše UTC). */
function datum(s: string | null): Date | null {
  if (!s) return null;
  const [d, t = '00:00:00'] = s.split(' ');
  const [g, m, dan] = d.split('-').map(Number);
  const [h, min, sek] = t.split(':').map(Number);
  return new Date(Date.UTC(g, m - 1, dan, h || 0, min || 0, sek || 0));
}

const pad = (n: number) => String(n).padStart(2, '0');

function zaglavlje(ws: ExcelJS.Worksheet, firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>, iz: KnjigovodjaIzvjestaj, izvezeno: Date, naslov: string) {
  ws.getCell('A1').value = firma.naziv || '—';
  ws.getCell('A1').font = { bold: true, size: 13 };
  ws.getCell('A2').value = [firma.idBroj && `JIB: ${firma.idBroj}`, firma.pdvBroj && `PDV broj: ${firma.pdvBroj}`].filter(Boolean).join('   ') || ' ';
  ws.getCell('A3').value = `${naslov} · Period: ${prikazPerioda(iz)} · Izvezeno: ${pad(izvezeno.getDate())}.${pad(izvezeno.getMonth() + 1)}.${izvezeno.getFullYear()}. ${pad(izvezeno.getHours())}:${pad(izvezeno.getMinutes())}`;
  ws.getCell('A3').font = { color: { argb: 'FF555555' } };
}

interface Raspored {
  /** Zadnji red s podacima (red naslova kad podataka nema). */
  zadnjiRed: number;
  /** Prvi slobodan red ispod tabele. */
  sljedeci: number;
}

/**
 * Tabela od reda `start` (naslovi). Red zbira (`oznakaZbira`, null = bez
 * njega) ide iza jednog praznog reda, da ga sort/filter podataka ne zahvati.
 */
function tabela<T>(ws: ExcelJS.Worksheet, start: number, kolone: Kolona<T>[], redovi: T[], oznakaZbira: string | null): Raspored {
  const naslovi = ws.getRow(start);
  kolone.forEach((k, i) => {
    const c = naslovi.getCell(i + 1);
    c.value = k.naslov;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8ECF2' } };
    c.border = { bottom: { style: 'thin' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });

  redovi.forEach((r, j) => {
    const red = ws.getRow(start + 1 + j);
    kolone.forEach((k, i) => {
      const c = red.getCell(i + 1);
      const v = k.v(r);
      c.value = v;
      if (k.format) c.numFmt = numFmt(k.format, v);
    });
  });

  const zadnjiRed = start + redovi.length;
  if (oznakaZbira === null) return { zadnjiRed, sljedeci: zadnjiRed + 1 };

  const raspon = (naslov: string) => {
    const i = kolone.findIndex(k => k.naslov === naslov);
    if (i < 0) throw new Error(`Nema kolone ${naslov}`);
    const slovo = ws.getColumn(i + 1).letter;
    return `${slovo}${start + 1}:${slovo}${zadnjiRed}`;
  };
  const redZbira = zadnjiRed + 2;
  const red = ws.getRow(redZbira);
  red.getCell(1).value = oznakaZbira;
  red.font = { bold: true };
  kolone.forEach((k, i) => {
    if (!k.zbir) return;
    const rezultat = typeof k.zbir === 'object'
      ? k.zbir.rezultat
      : Math.round(redovi.reduce((a, r) => a + (Number(k.v(r)) || 0), 0) * 100) / 100;
    const formula = typeof k.zbir === 'object' ? k.zbir.formula(raspon) : `SUM(${raspon(k.naslov)})`;
    const c = red.getCell(i + 1);
    c.value = redovi.length ? { formula, result: rezultat } : 0;
    c.numFmt = numFmt(k.format ?? 'km', rezultat);
    c.border = { top: { style: 'thin' } };
  });
  return { zadnjiRed, sljedeci: redZbira + 1 };
}

function list<T>(
  wb: ExcelJS.Workbook, ime: string, ctx: { firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>; iz: KnjigovodjaIzvjestaj; izvezeno: Date },
  kolone: Kolona<T>[], redovi: T[], oznakaZbira: string | null = 'Ukupno',
): { ws: ExcelJS.Worksheet; sljedeci: number } {
  const ws = wb.addWorksheet(ime, { views: [{ state: 'frozen', ySplit: PRVI_RED_PODATAKA - 1 }] });
  zaglavlje(ws, ctx.firma, ctx.iz, ctx.izvezeno, ime);
  kolone.forEach((k, i) => { ws.getColumn(i + 1).width = k.sirina; });
  const { zadnjiRed, sljedeci } = tabela(ws, PRVI_RED_PODATAKA - 1, kolone, redovi, oznakaZbira);
  // Filter samo nad podacima — red „Ukupno“ ostaje van sorta.
  ws.autoFilter = { from: { row: PRVI_RED_PODATAKA - 1, column: 1 }, to: { row: zadnjiRed, column: kolone.length } };
  return { ws, sljedeci };
}

const L = NAZIVI_LISTOVA;

export async function napraviExcel(
  iz: KnjigovodjaIzvjestaj, firma: Pick<FirmaSettings, 'naziv' | 'idBroj' | 'pdvBroj'>, izvezeno: Date,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = firma.naziv || 'Atlas';
  wb.created = izvezeno;
  const ctx = { firma, iz, izvezeno };

  list(wb, L.rekapitulacija, ctx, [
    { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
    { naslov: 'Broj računa', sirina: 10, v: r => r.brojRacuna, format: 'broj', zbir: true },
    { naslov: 'Osnovica 17%', sirina: 14, v: r => r.osnovicaE, format: 'km', zbir: true },
    { naslov: 'PDV 17%', sirina: 12, v: r => r.pdvE, format: 'km', zbir: true },
    { naslov: 'Oslobođeno (K)', sirina: 14, v: r => r.iznosK, format: 'km', zbir: true },
    { naslov: 'Ukupno', sirina: 14, v: r => r.ukupno, format: 'km', zbir: true },
    { naslov: 'Gotovina', sirina: 13, v: r => r.gotovina, format: 'km', zbir: true },
    { naslov: 'Kartica', sirina: 13, v: r => r.kartica, format: 'km', zbir: true },
    { naslov: 'Virman', sirina: 13, v: r => r.virman, format: 'km', zbir: true },
    { naslov: 'Ček', sirina: 11, v: r => r.cek, format: 'km', zbir: true },
    { naslov: 'Reklamacije', sirina: 13, v: r => r.reklamacije, format: 'km', zbir: true },
    { naslov: 'Neto', sirina: 14, v: r => r.neto, format: 'km', zbir: true },
  ], iz.dani);

  list(wb, L.kif, ctx, [
    { naslov: 'Datum i vrijeme', sirina: 17, v: r => datum(r.datum), format: 'datumVrijeme' },
    { naslov: 'Fiskalni broj', sirina: 12, v: r => r.fiskalniBroj },
    { naslov: 'Kupac', sirina: 26, v: r => r.kupac },
    { naslov: 'JIB kupca', sirina: 16, v: r => r.jib },
    { naslov: 'Osnovica 17%', sirina: 14, v: r => r.osnovicaE, format: 'km', zbir: true },
    { naslov: 'PDV 17%', sirina: 12, v: r => r.pdvE, format: 'km', zbir: true },
    { naslov: 'Oslobođeno (K)', sirina: 14, v: r => r.iznosK, format: 'km', zbir: true },
    { naslov: 'Ukupno', sirina: 14, v: r => r.ukupno, format: 'km', zbir: true },
    { naslov: 'Način plaćanja', sirina: 28, v: r => r.placanje },
    { naslov: 'Datum valute', sirina: 12, v: r => datum(r.datumValute), format: 'datum' },
    { naslov: 'Napomena', sirina: 18, v: r => r.oznaka },
  ], iz.kif);

  list(wb, L.reklamacije, ctx, [
    { naslov: 'Datum reklamacije', sirina: 17, v: r => datum(r.datum), format: 'datumVrijeme' },
    { naslov: 'Broj reklamacije', sirina: 14, v: r => r.brojReklamacije },
    { naslov: 'Fiskalni broj računa', sirina: 14, v: r => r.fiskalniBroj },
    { naslov: 'Datum računa', sirina: 17, v: r => datum(r.datumOriginala), format: 'datumVrijeme' },
    { naslov: 'Kupac', sirina: 24, v: r => r.kupac },
    { naslov: 'Osnovica 17%', sirina: 14, v: r => r.osnovicaE, format: 'km', zbir: true },
    { naslov: 'PDV 17%', sirina: 12, v: r => r.pdvE, format: 'km', zbir: true },
    { naslov: 'Oslobođeno (K)', sirina: 14, v: r => r.iznosK, format: 'km', zbir: true },
    { naslov: 'Ukupno', sirina: 14, v: r => r.ukupno, format: 'km', zbir: true },
    { naslov: 'Način plaćanja', sirina: 24, v: r => r.placanje },
  ], iz.reklamacije);

  if (iz.moduli.skladiste) {
    list(wb, L.kuf, ctx, [
      { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
      { naslov: 'Broj primke', sirina: 13, v: r => r.brojPrimke },
      { naslov: 'Dobavljač', sirina: 26, v: r => r.dobavljac },
      { naslov: 'JIB/ID dobavljača', sirina: 16, v: r => r.dobavljacId },
      { naslov: 'Broj fakture', sirina: 14, v: r => r.brojFakture },
      { naslov: 'Fakturna vrijednost', sirina: 14, v: r => r.fakturna, format: 'km', zbir: true },
      { naslov: 'Rabat', sirina: 11, v: r => r.rabat, format: 'km', zbir: true },
      { naslov: 'Zavisni troškovi', sirina: 12, v: r => r.zavisni, format: 'km', zbir: true },
      { naslov: 'Nabavna vrijednost', sirina: 14, v: r => r.nabavna, format: 'km', zbir: true },
      { naslov: 'PDV', sirina: 12, v: r => r.pdv, format: 'km', zbir: true },
      { naslov: 'Prodajna vrijednost', sirina: 14, v: r => r.prodajna, format: 'km', zbir: true },
      { naslov: 'RUC', sirina: 12, v: r => r.ruc, format: 'km', zbir: true },
    ], iz.kuf);

    list(wb, L.ulazStavke, ctx, [
      { naslov: 'Broj primke', sirina: 13, v: r => r.brojPrimke },
      { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra },
      { naslov: 'Artikal', sirina: 30, v: r => r.naziv },
      { naslov: 'JM', sirina: 6, v: r => r.jm },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Fakturna cijena', sirina: 12, v: r => r.fakturnaCijena, format: 'cijena' },
      { naslov: 'Rabat %', sirina: 8, v: r => r.rabat, format: 'kolicina' },
      { naslov: 'Zavisni troškovi', sirina: 12, v: r => r.zavisni, format: 'km', zbir: true },
      { naslov: 'Nabavna cijena', sirina: 12, v: r => r.nabavnaCijena, format: 'cijena' },
      { naslov: 'Prodajna cijena', sirina: 12, v: r => r.prodajnaCijena, format: 'km' },
      { naslov: 'PDV stopa', sirina: 8, v: r => r.pdvStopa },
    ], iz.ulazStavke);

    list(wb, L.nivelacije, ctx, [
      { naslov: 'Broj', sirina: 14, v: r => r.brojNivelacije },
      { naslov: 'Datum', sirina: 12, v: r => datum(r.datum), format: 'datum' },
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra ?? '—' },
      { naslov: 'Artikal', sirina: 30, v: r => r.naziv ?? '—' },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Stara cijena', sirina: 12, v: r => r.staraCijena, format: 'km' },
      { naslov: 'Nova cijena', sirina: 12, v: r => r.novaCijena, format: 'km' },
      { naslov: 'Razlika po jedinici', sirina: 12, v: r => r.razlika, format: 'km' },
      { naslov: 'Ukupna razlika', sirina: 14, v: r => r.ukupnaRazlika, format: 'km', zbir: true },
      { naslov: 'PDV stopa', sirina: 8, v: r => r.pdvStopa },
    ], iz.nivelacije);
  }

  list(wb, L.polog, ctx, [
    { naslov: 'Datum i vrijeme', sirina: 17, v: r => datum(r.createdAt), format: 'datumVrijeme' },
    { naslov: 'Vrsta', sirina: 10, v: r => (r.tip === 'polog' ? 'Polog' : 'Povrat') },
    { naslov: 'Polog', sirina: 12, v: r => (r.tip === 'polog' ? r.iznos : 0), format: 'km', zbir: true },
    { naslov: 'Povrat', sirina: 12, v: r => (r.tip === 'povrat' ? r.iznos : 0), format: 'km', zbir: true },
    { naslov: 'Korisnik', sirina: 16, v: r => r.korisnikIme ?? '' },
    { naslov: 'Napomena', sirina: 26, v: r => r.napomena ?? '' },
    { naslov: 'Fiskalni uređaj', sirina: 14, v: r => ({ ok: 'Evidentirano', error: 'Greška', skipped: 'Nije slano' }[r.tringStatus] ?? r.tringStatus) },
  ], iz.kretanjaNovca);

  if (iz.moduli.proizvodnja) {
    const { ws, sljedeci } = list(wb, L.utrosak, ctx, [
      { naslov: 'Nalog', sirina: 10, v: r => r.nalog },
      { naslov: 'Završen', sirina: 17, v: r => datum(r.zavrsen), format: 'datumVrijeme' },
      { naslov: 'Opis', sirina: 30, v: r => r.opis },
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra },
      { naslov: 'Materijal', sirina: 28, v: r => r.naziv },
      { naslov: 'JM', sirina: 6, v: r => r.jm },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Nabavna cijena', sirina: 12, v: r => r.nabavnaCijena, format: 'cijena' },
      { naslov: 'Vrijednost', sirina: 13, v: r => r.vrijednost, format: 'km', zbir: true },
    ], iz.utrosak);
    const start = sljedeci + 1;
    ws.getCell(`A${start}`).value = 'Zbir po materijalu';
    ws.getCell(`A${start}`).font = { bold: true, size: 12 };
    tabela(ws, start + 1, [
      { naslov: 'Šifra', sirina: 0, v: r => r.sifra },
      { naslov: 'Materijal', sirina: 0, v: r => r.naziv },
      { naslov: 'JM', sirina: 0, v: r => r.jm },
      { naslov: 'Količina', sirina: 0, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Vrijednost', sirina: 0, v: r => r.vrijednost, format: 'km', zbir: true },
    ], iz.utrosakZbir, 'Ukupno');
  }

  if (iz.moduli.skladiste) {
    list(wb, L.zalihe, ctx, [
      { naslov: 'Šifra', sirina: 12, v: r => r.sifra },
      { naslov: 'Artikal', sirina: 30, v: r => r.naziv },
      { naslov: 'JM', sirina: 6, v: r => r.jm },
      { naslov: 'Vrsta', sirina: 10, v: r => (r.tip === 'materijal' ? 'Materijal' : 'Roba') },
      { naslov: 'Količina', sirina: 10, v: r => r.kolicina, format: 'kolicina' },
      { naslov: 'Prosječna nabavna', sirina: 13, v: r => r.prosjecnaNabavna, format: 'cijena' },
      {
        naslov: 'Nabavna vrijednost', sirina: 14, v: r => r.nabavnaVrijednost, format: 'km',
        zbir: { formula: r => `SUMIF(${r('Količina')},">0",${r('Nabavna vrijednost')})`, rezultat: iz.zbir.zalihe.nabavna },
      },
      { naslov: 'Prodajna cijena', sirina: 12, v: r => r.prodajnaCijena, format: 'km' },
      {
        naslov: 'Prodajna vrijednost', sirina: 14, v: r => r.prodajnaVrijednost, format: 'km',
        zbir: { formula: r => `SUMIF(${r('Količina')},">0",${r('Prodajna vrijednost')})`, rezultat: iz.zbir.zalihe.prodajna },
      },
    ], iz.zalihe, 'Ukupno (bez minusa)');
  }

  const kontrola: { vrsta: VrstaUpozorenja | ''; opis: string }[] = iz.upozorenja.length ? iz.upozorenja : [{ vrsta: '', opis: '' }];
  const VRSTE: Record<VrstaUpozorenja | '', string> = {
    nezavrsen: 'Period još traje', praznina: 'Rupa u numeraciji', bezBroja: 'Bez fiskalnog broja', odstupanje: 'Odstupanje iznosa',
    placanje: 'Način plaćanja', minus: 'Zaliha u minusu', '': 'Nema upozorenja',
  };
  list(wb, L.kontrola, ctx, [
    { naslov: 'Vrsta', sirina: 22, v: r => VRSTE[r.vrsta] },
    { naslov: 'Opis', sirina: 90, v: r => r.opis },
  ], kontrola, null);

  return new Uint8Array(await wb.xlsx.writeBuffer());
}
