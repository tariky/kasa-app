/**
 * Poređenje PDF-ova slikama — sigurnosna mreža za izmjene PDF komponenti.
 *
 * Svih 10 PDF komponenti se renderuje s fiksnim podacima i zamrznutim datumom
 * (26.09.2026 12:00, Europe/Sarajevo), `pdftoppm -r 72 -png` napravi sliku svake
 * stranice, a `magick compare -metric AE` poredi stranice (0 = identično).
 *
 *   bun tools/pdf-poredjenje/poredjenje.tsx --baza <dir>      # referentne slike u <dir>
 *   bun tools/pdf-poredjenje/poredjenje.tsx --uporedi <dir>   # renderuje u <dir>.trenutno, poredi s <dir>
 *   … --samo <regex>                                          # samo slučajevi čije ime odgovara
 *
 * `--samo` koji ne pogodi nijedan slučaj je greška (kod 2) — tipfeler u regexu ne smije
 * proći kao „0 stranica, 0 razlika“. S `--samo` se iz foldera brišu samo slike i PDF-ovi
 * odabranih slučajeva; reference ostalih ostaju.
 *
 * `--uporedi` ispisuje broj različitih piksela po stranici (0 = identično), slike
 * razlika ostavlja u <dir>.razlike i izlazi s kodom 1 ako se išta razlikuje.
 * Referentne slike se ne drže u repou — pravi ih se na stanju prije izmjene.
 */
import React from 'react';
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renderToBuffer } from '@react-pdf/renderer';
import type { FirmaSettings, Order, OrderItem, Primka, Nivelacija, RadniNalog } from '../../src/types';
import { ZADANE_DOKUMENT_POSTAVKE, procitajDokumentPostavke, type DokumentPostavke } from '../../src/lib/dokumentPostavke';
import { izracunajTotale } from '../../src/lib/racun';
import { RacunPdf } from '../../src/components/RacunPdf';
import { PonudaPdf } from '../../src/components/PonudaPdf';
import { OtpremnicaPdf } from '../../src/components/OtpremnicaPdf';
import { PrilogPdf } from '../../src/components/PrilogPdf';
import { RadniNalogPdf } from '../../src/components/RadniNalogPdf';
import { UlazPdf } from '../../src/components/UlazPdf';
import { PrimkePdf } from '../../src/components/PrimkePdf';
import { PrometPdf } from '../../src/components/PrometPdf';
import { NivelacijaPdf } from '../../src/components/NivelacijaPdf';
import { KnjigovodjaPdf } from '../../src/components/KnjigovodjaPdf';
import type { KnjigovodjaIzvjestaj } from '../../src/lib/knjigovodja/obracun';

// ── Zamrznuto vrijeme ────────────────────────────────────
// Dokumenti ispisuju „Generisano: <danas>“ i vrijeme računa u lokalnoj zoni.
process.env.TZ = 'Europe/Sarajevo';
const PraviDate = Date;
const SADA = new PraviDate(2026, 8, 26, 12, 0, 0).getTime();
class ZamrznutiDate extends PraviDate {
  constructor(...a: unknown[]) {
    if (a.length === 0) super(SADA);
    else super(...(a as [string]));
  }
  static now() { return SADA; }
}
globalThis.Date = ZamrznutiDate as DateConstructor;

const BIN = '/opt/homebrew/bin';
const PDFTOPPM = existsSync(`${BIN}/pdftoppm`) ? `${BIN}/pdftoppm` : 'pdftoppm';
const MAGICK = existsSync(`${BIN}/magick`) ? `${BIN}/magick` : 'magick';

// ── Podaci ───────────────────────────────────────────────

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAMAAADVRocKAAAAD1BMVEX///9PQy0fKTefbx31nguAf96RAAAAAXRSTlMAQObYZgAAAVNJREFUaN7tmtsSgzAIBUXy/9/c6W2q1gCJbNWp59k5KyFtAjgMlw4oGbslpHkEkmBvInLs76L91wmZ/muEXP9vQrb/kpC0f6YSOIB5CEAA8xAI/1kIpwcgKZgmgfGfhPA3AFEtd6kGk9YCkKf3RxFIHLB0fzGyAFJqkhRAsbQdoMWWbgR4/iYhAPD9LYIPiPgbBBcQ868TPEDUv0rwAGH/2m51AA3+FYINkCaAtAOa/NdDMAHxDNfzbAIa/VdDsABtGahkwQKo+4KBNbIA/goE1mhPgHQApAWgHQA9FCCwzQOPXIBDA86/TfFf8vn/7PjzAD/R8DOZv1Xg9yL+ZoffTfnbNV8f4BUOX6PxVSZfJ/OV/oj3Kka+2zLi/aJHFGzH6w0Be3Zd+h0Aby2fv/vOA/ARCz4k4sdc+KCOHzXyw1J+3MsPrPmRew4C/TLBN7+0g25VY0kBS0lXugAAAABJRU5ErkJggg==';
const PECAT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAABkCAMAAAA2aMu9AAAABlBMVEX///8dTtinztswAAAAAXRSTlMAQObYZgAAAclJREFUaN7t2kuSgzAMBFB8/0vPOgWSWl+3a6xlCrcexCHBzvPcunXr1pKLV7bdCds2KAO2QWVK1270tJ03hluNGPMdWo1V0U3E2tByYsMpV0Z2zeui3LGPXT7C0Sw2LOcL0LDmCaE9FLJ5UoI+GOc/BGpl+AAd/laYgRW+4MTWhzkTIZ4Dhwz25MrHZnR12eKRaZ0e453TTbx0C/2eUaDT8hChNrKMJ0bawM8jqi+fQrRaKb5qXkgo+xp4QrYqnPYpQsW3rIRmoXwJJV8j77OF8XU47ROFgm+pQ2eE6hfN65Uh4IcQAw74pEvI48OEZwA3+QTh20cG1F8Z9b3anQpURgwDHwg46Hv1CwBXdV0gG7C5IkC+TzH9ffAoINt3Mf2vmUN+DzID6Z9JTnmqI34upl9Z4F+boV/d4l8f5F9hpV+jnhVGfPz7JPw7TfR7dfy7nfz7xfw77ihx338WrBHrtxw0KzB0xkhX7Z5hnktw2tiXaPkq3CdBRJXJHlBz/EjH/HTMZKRxLKI7u4tYmOt5zzZFuubVcNp3aDi2KgeJdofnEwIdsCbhgVXG746eY8eMWDXqCoztuoRyzBZQbrCBzs2yW7f+Q/0BaScMWIgLzVcAAAAASUVORK5CYII=';

const FIRMA: FirmaSettings = {
  naziv: 'Stolarija Hrast d.o.o.', adresa: 'Zmaja od Bosne 12', grad: 'Sarajevo',
  idBroj: '4200000000001', pdvBroj: '200000000001', skladiste: 'Glavno skladište',
  web: 'www.hrast.ba', email: 'info@hrast.ba', logo: LOGO, logoVelicina: 72,
  ziroRacuniPozicija: 'zaglavlje',
  bankAccounts: [
    { bankName: 'UniCredit Bank d.d.', accountNumber: '3386902212345678' },
    { bankName: 'Raiffeisen Bank d.d. BiH', accountNumber: '1610000012345678' },
  ],
};
const FIRMA_PODNOZJE: FirmaSettings = { ...FIRMA, ziroRacuniPozicija: 'podnozje' };
/** Najgori slučaj za podnožje: izabrano podnožje, a računa nema. */
const FIRMA_BEZ_RACUNA: FirmaSettings = { ...FIRMA, logo: '', web: '', email: '', ziroRacuniPozicija: 'podnozje', bankAccounts: [] };
/** Izvještaj bez kontakta, ID i PDV broja (desna kolona zaglavlja prazna) i bez naziva skladišta. */
const FIRMA_BEZ_BROJEVA: FirmaSettings = { ...FIRMA_BEZ_RACUNA, idBroj: '', pdvBroj: '', skladiste: '' };

const ZADANO = ZADANE_DOKUMENT_POSTAVKE;
const SVE: DokumentPostavke = procitajDokumentPostavke({
  'dokumenti.pecat': PECAT, 'dokumenti.pecatVelicina': '110',
  'dokumenti.pecat.faktura': 'true', 'dokumenti.pecat.ponuda': 'true',
  'dokumenti.pecat.otpremnica': 'true', 'dokumenti.pecat.racun': 'true',
  // Dugačak tekst podnožja (limit je 300 znakova, maxLines 4).
  'dokumenti.podnozje': 'Upisano u sudski registar Općinskog suda u Sarajevu pod brojem 065-0-Reg-26-000123. Temeljni kapital 2.000,00 KM uplaćen u cijelosti. '.repeat(3),
  'dokumenti.kolone.sifra': 'true', 'dokumenti.kolone.jm': 'true',
  'dokumenti.potpis.faktura.lijevo': 'Fakturisao', 'dokumenti.potpis.nalog.desno': 'Majstor',
  'dokumenti.ponuda.prefiks': 'P-', 'dokumenti.ponuda.cifara': '4',
});
const SVE_BEZ_JM: DokumentPostavke = { ...SVE, kolone: { sifra: true, jm: false }, ponuda: { ...SVE.ponuda, uslovi: '' } };

const STAVKE: OrderItem[] = [
  { id: 1, orderId: 42, productId: 1, kolicina: 2, cijena: 11.7, rabat: 2.5, pdvStopa: 'E', productNaziv: 'Polica hrastova 80 cm', productJm: 'kom', productSifra: 'P-080' },
  // 5,35 × 50 % = 2,675: iznos reda mora biti 2,68 kao u UKUPNO (bug 3).
  { id: 2, orderId: 42, productId: 2, kolicina: 1, cijena: 5.35, rabat: 50, pdvStopa: 'E', productNaziv: 'Vijak za drvo 4x40 (pakovanje)', productJm: 'pak', productSifra: 'V440' },
  { id: 3, orderId: 42, productId: 3, kolicina: 1.5, cijena: 20, rabat: 0, pdvStopa: 'K', productNaziv: 'Montaža', productJm: 'h', productSifra: 'USL1' },
  { id: 4, orderId: 42, productId: 4, kolicina: 3, cijena: 45.9, rabat: 10, pdvStopa: 'E', productNaziv: 'Ploča iverica bijela 18 mm, rezanje po mjeri i kantiranje ABS trakom 2 mm', productJm: 'm2', productSifra: '3871234567890' },
];
const BEZ_RABATA: OrderItem[] = STAVKE.map(s => ({ ...s, rabat: 0 }));
/** Dovoljno redova za drugu stranicu (podnožje i žiro računi na svakoj stranici). */
const DUGE: OrderItem[] = Array.from({ length: 36 }, (_, i) => ({
  id: 100 + i, orderId: 42, productId: 100 + i, kolicina: (i % 5) + 1,
  cijena: Math.round((3.15 + i * 1.37) * 100) / 100, rabat: i % 4 === 0 ? 5 : 0, pdvStopa: i % 7 === 3 ? 'K' : 'E',
  productNaziv: `Artikal broj ${i + 1}${i % 6 === 0 ? ' s dugim opisom koji se prelama u dva reda na dokumentu' : ''}`,
  productJm: 'kom', productSifra: `A${1000 + i}`,
}));

function order(stavke: OrderItem[], extra: Partial<Order> = {}): Order {
  return {
    id: 42, korisnikId: 1, ...izracunajTotale(stavke), nacinPlacanja: 'Virman', status: 'completed',
    brojFiskalnogRacuna: '1234', prilogBroj: 7, createdAt: '2026-09-25 10:30:00', korisnikIme: 'Admin',
    kupacNaziv: 'Kupac d.o.o.', kupacIdBroj: '4200000000002', kupacPdvBroj: '200000000002',
    kupacAdresa: 'Titova 5', kupacGrad: 'Zenica', kupacPostanskiBroj: '72000', stavke, ...extra,
  };
}

function ponuda(stavke: OrderItem[], extra: Record<string, unknown> = {}) {
  return {
    id: 3, broj: 17, godina: 2026, datum: '2026-09-25', vaziDo: '2026-10-03', napomena: null,
    ...izracunajTotale(stavke), korisnikIme: 'Admin',
    kupacNaziv: 'Kupac d.o.o.', kupacIdBroj: '4200000000002', kupacPdvBroj: '200000000002',
    kupacAdresa: 'Titova 5', kupacGrad: 'Zenica', kupacPostanskiBroj: '72000',
    stavke: stavke.map(s => ({ id: s.id, productNaziv: s.productNaziv, productJm: s.productJm, productSifra: s.productSifra, kolicina: s.kolicina, cijena: s.cijena, rabat: s.rabat, pdvStopa: s.pdvStopa })),
    ...extra,
  };
}

const NALOG: RadniNalog = {
  id: 1, broj: 12, godina: 2026, datum: '2026-09-25', rok: '2026-10-05', vrsta: 'narudzba', kupacId: 1, ponudaId: 3,
  opis: 'Izrada kuhinjskih elemenata po mjeri (gornji i donji dio, 3,2 m)', productId: null, kolicina: 1,
  dogovorenaCijena: 1850, trosakRada: 400, status: 'otvoren', korisnikId: 1, napomena: 'Kupac dolazi po robu sam.',
  createdAt: '2026-09-25 09:00:00', kupacNaziv: 'Kupac d.o.o.', kupacAdresa: 'Titova 5', kupacGrad: 'Zenica', kupacPostanskiBroj: '72000',
  korisnikIme: 'Admin', ponudaBroj: 17, ponudaGodina: 2026,
  stavke: [
    { id: 1, radniNalogId: 1, materijalId: 4, kolicina: 4.25, nabavnaCijena: null, napomena: 'Rezati po skici', materijalNaziv: 'Ploča iverica bijela 18 mm', materijalSifra: '3871234567890', materijalJm: 'm2' },
    { id: 2, radniNalogId: 1, materijalId: 5, kolicina: 24, nabavnaCijena: null, napomena: '', materijalNaziv: 'ABS traka 2 mm', materijalSifra: 'ABS2', materijalJm: 'm' },
  ],
} as RadniNalog;

const PRIMKA: Primka = {
  id: 5, brojPrimke: 'P-2026-005', datum: '2026-09-20', dobavljacNaziv: 'Drvo-Trade d.o.o.', dobavljacId: '4200000000077',
  dobavljacAdresa: 'Industrijska 3, Visoko', brojFakture: 'F-889/26', createdAt: '2026-09-20 09:00:00',
  stavke: [
    { id: 1, primkaId: 5, productId: 1, kolicina: 10, nabavnaCijena: 8.5, rabat: 5, zavisniTroskovi: 4.2, cijena: 14.9, pdvStopa: 'E', createdAt: '2026-09-20 09:00:00', productNaziv: 'Polica hrastova 80 cm', productJm: 'kom', productSifra: 'P-080' },
    { id: 2, primkaId: 5, productId: 2, kolicina: 200, nabavnaCijena: 0.021, rabat: 0, zavisniTroskovi: 0.8, cijena: 0.05, pdvStopa: 'E', createdAt: '2026-09-20 09:00:00', productNaziv: 'Vijak za drvo 4x40', productJm: 'kom', productSifra: 'V440' },
    { id: 3, primkaId: 5, productId: 4, kolicina: 12.5, nabavnaCijena: 18.4, rabat: 3, zavisniTroskovi: 11, cijena: 0, pdvStopa: 'E', createdAt: '2026-09-20 09:00:00', productNaziv: 'Ploča iverica bijela 18 mm', productJm: 'm2', productSifra: '3871234567890' },
    { id: 4, primkaId: 5, productId: 6, kolicina: 3, nabavnaCijena: 120, rabat: 0, zavisniTroskovi: 0, cijena: 175.5, pdvStopa: 'K', createdAt: '2026-09-20 09:00:00', productNaziv: 'Radni sto', productJm: 'kom', productSifra: 'RS1' },
  ],
};
const PRIMKA_MATERIJAL: Primka = { ...PRIMKA, id: 6, brojPrimke: 'P-2026-006', stavke: (PRIMKA.stavke ?? []).filter(s => s.cijena === 0) };
/** Primka bez dobavljača, fakture i datuma (spisak primki pada na `createdAt` i „—“). */
const PRIMKA_BEZ_DOBAVLJACA: Primka = { ...PRIMKA_MATERIJAL, id: 8, brojPrimke: 'P-2026-008', datum: '', dobavljacNaziv: '', dobavljacId: '', dobavljacAdresa: '', brojFakture: '' };
/** Dovoljno stavki za drugu stranicu kalkulacije (pejzaž). */
const PRIMKA_DUGA: Primka = {
  ...PRIMKA, id: 7, brojPrimke: 'P-2026-007', brojFakture: '', dobavljacAdresa: undefined,
  stavke: Array.from({ length: 45 }, (_, i) => {
    const nabavna = Math.round((2.1 + i * 0.83) * 100) / 100;
    return {
      id: 100 + i, primkaId: 7, productId: 100 + i, kolicina: (i % 5) + 1, nabavnaCijena: nabavna, rabat: i % 4 === 0 ? 5 : 0,
      zavisniTroskovi: i % 6 === 0 ? 1.5 : 0, cijena: i % 10 === 9 ? 0 : Math.round(nabavna * 1.6 * 100) / 100,
      pdvStopa: i % 7 === 3 ? 'K' : 'E', createdAt: '2026-09-20 09:00:00',
      productNaziv: `Artikal broj ${i + 1}${i % 6 === 0 ? ' s dugim nazivom koji se prelama' : ''}`, productJm: 'kom', productSifra: `A${1000 + i}`,
    };
  }),
};

const PROMET_ORDERS = [
  { id: 1, createdAt: '2026-09-02 08:15:00', korisnikIme: 'Admin', brojFiskalnogRacuna: '1230', nacinPlacanja: 'Gotovina', ukupno: 23.4, pdvIznos: 3.4, status: 'completed' },
  { id: 2, createdAt: '2026-09-02 09:40:00', korisnikIme: 'Kasir', brojFiskalnogRacuna: '1231', nacinPlacanja: 'Kartica', ukupno: 117, pdvIznos: 17, status: 'completed' },
  { id: 3, createdAt: '2026-09-03 12:05:00', korisnikIme: 'Admin', brojFiskalnogRacuna: '1232', nacinPlacanja: '{"gotovina":10,"kartica":13.4}', ukupno: 23.4, pdvIznos: 3.4, status: 'completed' },
  { id: 4, createdAt: '2026-09-04 16:20:00', korisnikIme: 'Admin', brojFiskalnogRacuna: '1233', nacinPlacanja: 'Virman', ukupno: 58.5, pdvIznos: 8.5, status: 'refunded' },
];
/** Dovoljno računa za više stranica izvještaja; storna i računi bez kasira/načina plaćanja. */
const PROMET_DUGI = Array.from({ length: 75 }, (_, i) => {
  const ukupno = Math.round((11.7 + i * 3.51) * 100) / 100;
  const dvije = (n: number) => String(n).padStart(2, '0');
  return {
    id: 100 + i, createdAt: `2026-09-${dvije(1 + (i % 28))} ${dvije(8 + (i % 10))}:${dvije((i * 7) % 60)}:00`,
    korisnikIme: i % 11 === 5 ? '' : i % 3 ? 'Kasir' : 'Admin', brojFiskalnogRacuna: i % 13 === 7 ? '' : String(2000 + i),
    nacinPlacanja: i % 17 === 8 ? '' : ['Gotovina', 'Kartica', 'Virman', 'Ček'][i % 4],
    ukupno, pdvIznos: Math.round((ukupno * 17) / 117 * 100) / 100, status: i % 9 === 4 ? 'refunded' : 'completed',
  };
});

const NIVELACIJA: Nivelacija = {
  id: 2, brojNivelacije: 'N-2026-002', datum: '2026-09-21', primkaId: 5, napomena: 'Nova cijena s ulaza', createdAt: '2026-09-21 10:00:00',
  primkaBroj: 'P-2026-005',
  stavke: [
    { id: 1, nivelacijaId: 2, productId: 1, kolicina: 4, staraCijena: 13.9, novaCijena: 14.9, razlika: 1, ukupnaRazlika: 4, pdvStopa: 'E', productNaziv: 'Polica hrastova 80 cm', productSifra: 'P-080', productJm: 'kom' },
    { id: 2, nivelacijaId: 2, productId: 2, kolicina: 150, staraCijena: 0.06, novaCijena: 0.05, razlika: -0.01, ukupnaRazlika: -1.5, pdvStopa: 'E', productNaziv: 'Vijak za drvo 4x40', productSifra: 'V440', productJm: 'kom' },
    { id: 3, nivelacijaId: 2, productId: 6, kolicina: 1, staraCijena: 160, novaCijena: 175.5, razlika: 15.5, ukupnaRazlika: 15.5, pdvStopa: 'K', productNaziv: 'Radni sto', productSifra: 'RS1', productJm: 'kom' },
  ],
};

/** Bez vezane primke i napomene (desna kolona bez tih redova). */
const NIVELACIJA_BEZ_VEZE: Nivelacija = { ...NIVELACIJA, id: 3, brojNivelacije: 'N-2026-003', primkaId: null, primkaBroj: undefined, napomena: null };

const KNJIGOVODJA: KnjigovodjaIzvjestaj = {
  od: '2026-09-01', do: '2026-09-30', moduli: { skladiste: true, proizvodnja: true },
  dani: [], kif: [], reklamacije: [], kuf: [], ulazStavke: [], nivelacije: [], kretanjaNovca: [], utrosak: [], utrosakZbir: [], zalihe: [],
  upozorenja: [
    { vrsta: 'praznina', opis: 'Praznina u numeraciji fiskalnih računa: 1235–1237' },
    { vrsta: 'placanje', opis: 'Račun 1240: nepoznat način plaćanja „cek“' },
  ],
  zbir: {
    promet: { osnovicaE: 1000, pdvE: 170, iznosK: 30, ukupno: 1200, gotovina: 700, kartica: 300, virman: 200, cek: 0, brojRacuna: 23 },
    reklamacije: { osnovicaE: 10, pdvE: 1.7, iznosK: 0, ukupno: 11.7, broj: 1 },
    neto: 1188.3, ulaz: { brojPrimki: 2, nabavna: 850.4, pdv: 144.57, prodajna: 1234.56 }, nivelacijeRazlika: -12.5,
    polozi: 100, povrati: 50, utrosak: { brojNaloga: 3, vrijednost: 245.1 }, zalihe: { nabavna: 15230.75, prodajna: 22110.4 },
  },
};

// ── Slučajevi ────────────────────────────────────────────

const SLUCAJEVI: Array<[ime: string, el: () => React.ReactElement]> = [
  ['racun-zaglavlje-zadano', () => <RacunPdf order={order(STAVKE)} firma={FIRMA} postavke={ZADANO} />],
  ['racun-podnozje-sve', () => <RacunPdf order={order(STAVKE, { nacinPlacanja: '{"gotovina":20,"kartica":131.6}', datumValute: '2026-10-10' })} firma={FIRMA_PODNOZJE} postavke={SVE} />],
  ['racun-en-zaglavlje-sve', () => <RacunPdf order={order(STAVKE, { nacinPlacanja: 'Gotovina' })} firma={FIRMA} postavke={SVE} lang="en" />],
  ['racun-bez-racuna-storno', () => <RacunPdf order={order(BEZ_RABATA, { status: 'refunded', brojReklamacije: '3' })} firma={FIRMA_BEZ_RACUNA} postavke={SVE_BEZ_JM} />],
  ['racun-podnozje-dugi', () => <RacunPdf order={order(DUGE)} firma={FIRMA_PODNOZJE} postavke={SVE} />],
  ['racun-en-podnozje-zadano', () => <RacunPdf order={order(STAVKE, { nacinPlacanja: 'Kartica' })} firma={FIRMA_PODNOZJE} postavke={ZADANO} lang="en" />],

  ['ponuda-zaglavlje-zadano', () => <PonudaPdf ponuda={ponuda(STAVKE)} firma={FIRMA} postavke={ZADANO} />],
  ['ponuda-podnozje-sve', () => <PonudaPdf ponuda={ponuda(STAVKE, { napomena: 'Isporuka 5 radnih dana od potvrde ponude.' })} firma={FIRMA_PODNOZJE} postavke={SVE} />],
  ['ponuda-bez-racuna', () => <PonudaPdf ponuda={ponuda(BEZ_RABATA)} firma={FIRMA_BEZ_RACUNA} postavke={SVE_BEZ_JM} />],
  ['ponuda-zaglavlje-dugi', () => <PonudaPdf ponuda={ponuda(DUGE, { napomena: 'Isporuka 5 radnih dana od potvrde ponude.' })} firma={FIRMA} postavke={SVE} />],

  ['otpremnica-zaglavlje-zadano', () => <OtpremnicaPdf order={order(STAVKE)} firma={FIRMA} postavke={ZADANO} />],
  ['otpremnica-podnozje-sve', () => <OtpremnicaPdf order={order(STAVKE)} firma={FIRMA_PODNOZJE} postavke={SVE} />],
  ['otpremnica-bez-racuna', () => <OtpremnicaPdf order={order(BEZ_RABATA, { kupacNaziv: undefined, kupacIdBroj: undefined })} firma={FIRMA_BEZ_RACUNA} postavke={SVE_BEZ_JM} />],
  ['otpremnica-zaglavlje-dugi', () => <OtpremnicaPdf order={order(DUGE)} firma={FIRMA} postavke={ZADANO} />],

  ['prilog-zaglavlje-zadano', () => <PrilogPdf order={order(STAVKE)} firma={FIRMA} stavke={STAVKE} postavke={ZADANO} />],
  ['prilog-podnozje-sve', () => <PrilogPdf order={order(STAVKE, { napomena: 'Roba se preuzima u skladištu.', datumValute: '2026-10-10' })} firma={FIRMA_PODNOZJE} stavke={STAVKE} postavke={SVE} />],
  ['prilog-bez-racuna', () => <PrilogPdf order={order(BEZ_RABATA)} firma={FIRMA_BEZ_RACUNA} stavke={BEZ_RABATA} postavke={SVE_BEZ_JM} />],
  ['prilog-podnozje-dugi', () => <PrilogPdf order={order(DUGE)} firma={FIRMA_PODNOZJE} stavke={DUGE} postavke={SVE} />],

  ['nalog-narudzba-zadano', () => <RadniNalogPdf nalog={NALOG} firma={FIRMA} postavke={ZADANO} />],
  ['nalog-zaliha-sve', () => <RadniNalogPdf nalog={{ ...NALOG, vrsta: 'zaliha', productNaziv: 'Polica hrastova 80 cm', kolicina: 12.5, ponudaBroj: null }} firma={FIRMA_PODNOZJE} postavke={SVE} />],
  ['nalog-bez-stavki', () => <RadniNalogPdf nalog={{ ...NALOG, stavke: [], rok: null, napomena: null }} firma={FIRMA_BEZ_RACUNA} postavke={SVE_BEZ_JM} />],

  ['ulaz-artikli-materijal', () => <UlazPdf primka={PRIMKA} firma={FIRMA} />],
  ['ulaz-samo-materijal', () => <UlazPdf primka={PRIMKA_MATERIJAL} firma={FIRMA_BEZ_RACUNA} />],
  ['ulaz-dugi', () => <UlazPdf primka={PRIMKA_DUGA} firma={FIRMA_BEZ_BROJEVA} />],
  ['primke', () => <PrimkePdf primke={[PRIMKA, PRIMKA_MATERIJAL]} dateFrom="01.09.2026" dateTo="30.09.2026" firma={FIRMA} />],
  ['primke-bez-brojeva', () => <PrimkePdf primke={[PRIMKA_BEZ_DOBAVLJACA, PRIMKA_DUGA]} dateFrom="01.09.2026" dateTo="30.09.2026" firma={FIRMA_BEZ_BROJEVA} />],
  ['promet', () => <PrometPdf orders={PROMET_ORDERS} dateFrom="01.09.2026" dateTo="30.09.2026" firma={FIRMA} />],
  ['promet-dugi', () => <PrometPdf orders={PROMET_DUGI} dateFrom="01.09.2026" dateTo="30.09.2026" firma={FIRMA_BEZ_BROJEVA} />],
  ['nivelacija', () => <NivelacijaPdf nivelacija={NIVELACIJA} firma={FIRMA} />],
  ['nivelacija-bez-veze', () => <NivelacijaPdf nivelacija={NIVELACIJA_BEZ_VEZE} firma={FIRMA_BEZ_BROJEVA} />],
  ['knjigovodja', () => <KnjigovodjaPdf izvjestaj={KNJIGOVODJA} firma={FIRMA} izvezeno={new Date()} />],
];

// ── Renderovanje i poređenje ─────────────────────────────

async function pokreni(cmd: string[]): Promise<{ kod: number; izlaz: string }> {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { kod: await p.exited, izlaz: (out + err).trim() };
}

/** Ime slučaja iz imena fajla: `ime.pdf`, `ime.3.png` ili nedovršeni `ime__-03.png`. */
const slucajFajla = (f: string) => f.replace(/(__-\d+|\.\d+)?\.(png|pdf)$/, '');

/** Slučajevi koje `--samo` bira (svi bez filtera). */
const odabrani = (filter: RegExp | null) => SLUCAJEVI.filter(([ime]) => !filter || filter.test(ime));

/**
 * Obriše stare slike i PDF-ove odabranih slučajeva iz foldera (ništa drugo; bez filtera sve
 * slike i PDF-ove) i renderuje te slučajeve u njega.
 */
async function renderujSve(dir: string, filter: RegExp | null): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) {
    if (/\.(png|pdf)$/.test(f) && (!filter || filter.test(slucajFajla(f)))) rmSync(join(dir, f));
  }
  const imena: string[] = [];
  for (const [ime, el] of odabrani(filter)) {
    const pdfPut = join(dir, `${ime}.pdf`);
    await Bun.write(pdfPut, await renderToBuffer(el() as any));
    const r = await pokreni([PDFTOPPM, '-r', '72', '-png', pdfPut, join(dir, `${ime}__`)]);
    if (r.kod !== 0) throw new Error(`pdftoppm ${ime}: ${r.izlaz}`);
    // pdftoppm dopunjava broj stranice nulama po ukupnom broju stranica — ime.<stranica>.png je stabilno.
    for (const f of readdirSync(dir)) {
      const m = f.match(/^(.*)__-0*(\d+)\.png$/);
      if (m && m[1] === ime) renameSync(join(dir, f), join(dir, `${ime}.${m[2]}.png`));
    }
    imena.push(ime);
  }
  return imena;
}

const slike = (dir: string) => new Set(readdirSync(dir).filter(f => f.endsWith('.png')));

/**
 * Broj piksela koji se razlikuju u bilo kojem kanalu. ImageMagick 7.1.2 za `-metric AE`
 * ne ispisuje broj piksela nego zbir razlika u jedinicama kvantuma (1 crn piksel = 65535),
 * pa je AE dobar samo za „0 = identično“; broj se računa iz slike razlike.
 */
async function razlicitihPiksela(a: string, b: string): Promise<string> {
  const r = await pokreni([MAGICK, a, b, '-compose', 'difference', '-composite', '-separate',
    '-evaluate-sequence', 'max', '-threshold', '0', '-format', '%[fx:round(mean*w*h)]', 'info:']);
  return r.izlaz;
}

async function uporedi(baza: string, filter: RegExp | null): Promise<number> {
  const trenutno = `${baza}.trenutno`;
  const razlike = `${baza}.razlike`;
  await renderujSve(trenutno, filter);
  rmSync(razlike, { recursive: true, force: true });
  mkdirSync(razlike, { recursive: true });

  const prije = slike(baza);
  const sada = slike(trenutno);
  const sve = [...new Set([...prije, ...sada])]
    .filter(f => !filter || filter.test(slucajFajla(f)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  let razlicitih = 0;
  for (const f of sve) {
    const naziv = f.replace(/\.png$/, '').padEnd(34);
    if (!prije.has(f)) { console.log(`${naziv} NOVA STRANICA`); razlicitih++; continue; }
    if (!sada.has(f)) { console.log(`${naziv} STRANICA NEDOSTAJE`); razlicitih++; continue; }
    const diff = join(razlike, f);
    const r = await pokreni([MAGICK, 'compare', '-metric', 'AE', join(baza, f), join(trenutno, f), diff]);
    const ae = Number.parseFloat(r.izlaz);
    if (r.kod === 0 && ae === 0) {
      rmSync(diff, { force: true });
      console.log(`${naziv} 0`);
    } else if (r.kod === 2 || !Number.isFinite(ae)) {
      razlicitih++;
      console.log(`${naziv} GREŠKA: ${r.izlaz}`);
    } else {
      razlicitih++;
      console.log(`${naziv} ${await razlicitihPiksela(join(baza, f), join(trenutno, f))} piksela (AE ${ae})  → ${diff}`);
    }
  }
  console.log(`\n${sve.length} stranica, ${razlicitih} s razlikama${razlicitih ? ` (slike razlika: ${razlike})` : ''}`);
  return razlicitih;
}

async function main() {
  const args = process.argv.slice(2);
  const vrijednost = (ime: string) => { const i = args.indexOf(ime); return i >= 0 ? args[i + 1] : undefined; };
  const samo = vrijednost('--samo');
  const filter = samo ? new RegExp(samo) : null;
  if (filter && odabrani(filter).length === 0) {
    console.error(`--samo ${samo}: nijedan slučaj ne odgovara (slučajevi: ${SLUCAJEVI.map(([ime]) => ime).join(', ')})`);
    return 2;
  }
  const baza = vrijednost('--baza');
  const poredi = vrijednost('--uporedi');
  if (baza) {
    const dir = resolve(baza);
    const imena = await renderujSve(dir, filter);
    const stranica = [...slike(dir)].filter(f => imena.includes(slucajFajla(f))).length;
    console.log(`${imena.length} PDF-ova, ${stranica} stranica → ${dir}`);
    return 0;
  }
  if (poredi) {
    const dir = resolve(poredi);
    if (!existsSync(dir)) { console.error(`Nema referentnih slika: ${dir} (prvo --baza)`); return 2; }
    return (await uporedi(dir, filter)) ? 1 : 0;
  }
  console.error('Upotreba: bun tools/pdf-poredjenje/poredjenje.tsx --baza <dir> | --uporedi <dir> [--samo <regex>]');
  return 2;
}

process.exit(await main());
