// Izvještaj za knjigovođu: sirovi podaci kanala izvoz:knjigovodja → redovi i
// zbirovi. Jedini izvor brojeva za Excel, PDF i pregled na ekranu. Pravila su
// u specu (docs/superpowers/specs/2026-09-25-izvoz-knjigovodja-design.md, §2).
import { round2 } from '../novac';
import { iznosStavke } from '../racun';
import { fakturnaVrijednost, rabatIznos, nabavnaVrijednost, pdvStopaPct } from '../kalkulacija';
import { parseFiskalniBroj, izracunajPraznine, MAX_PRAZNINA } from '../fiskalni';
import { prikazDatuma } from './period';
import type {
  KnjigovodjaPodaci, IzvozRacun, IzvozStavkaRacuna, IzvozNivelacijaStavka, IzvozKretanjeNovca,
} from './tipovi';

export interface Moduli {
  skladiste: boolean;
  proizvodnja: boolean;
}

export interface Stope {
  osnovicaE: number;
  pdvE: number;
  iznosK: number;
  ukupno: number;
}

export interface Placanja {
  gotovina: number;
  kartica: number;
  virman: number;
  cek: number;
}

export interface KifRed extends Stope {
  id: number;
  datum: string;
  fiskalniBroj: string;
  kupac: string;
  jib: string;
  placanje: string;
  datumValute: string | null;
  oznaka: string;
}

export interface ReklamacijaRed extends Stope {
  id: number;
  datum: string;
  brojReklamacije: string;
  fiskalniBroj: string;
  datumOriginala: string;
  kupac: string;
  placanje: string;
}

export interface DanRed extends Stope, Placanja {
  datum: string;
  brojRacuna: number;
  reklamacije: number;
  neto: number;
}

export interface KufRed {
  datum: string;
  brojPrimke: string;
  dobavljac: string;
  dobavljacId: string;
  brojFakture: string;
  fakturna: number;
  rabat: number;
  zavisni: number;
  nabavna: number;
  pdv: number;
  prodajna: number;
  ruc: number;
}

export interface UlazStavkaRed {
  brojPrimke: string;
  datum: string;
  sifra: string;
  naziv: string;
  jm: string;
  kolicina: number;
  fakturnaCijena: number;
  rabat: number;
  zavisni: number;
  nabavnaCijena: number;
  prodajnaCijena: number;
  pdvStopa: string;
}

export interface UtrosakRed {
  nalog: string;
  zavrsen: string;
  opis: string;
  sifra: string;
  naziv: string;
  jm: string;
  kolicina: number;
  nabavnaCijena: number;
  vrijednost: number;
}

export interface UtrosakZbir {
  sifra: string;
  naziv: string;
  jm: string;
  kolicina: number;
  vrijednost: number;
}

export interface ZalihaRed {
  sifra: string;
  naziv: string;
  jm: string;
  tip: string;
  kolicina: number;
  prosjecnaNabavna: number;
  nabavnaVrijednost: number;
  prodajnaCijena: number;
  prodajnaVrijednost: number;
}

export type VrstaUpozorenja = 'nezavrsen' | 'praznina' | 'bezBroja' | 'odstupanje' | 'placanje' | 'minus';

export interface Upozorenje {
  vrsta: VrstaUpozorenja;
  opis: string;
}

export interface Zbir {
  promet: Stope & Placanja & { brojRacuna: number };
  reklamacije: Stope & { broj: number };
  neto: number;
  ulaz: { brojPrimki: number; nabavna: number; pdv: number; prodajna: number };
  nivelacijeRazlika: number;
  polozi: number;
  povrati: number;
  utrosak: { brojNaloga: number; vrijednost: number };
  zalihe: { nabavna: number; prodajna: number };
}

export interface KnjigovodjaIzvjestaj {
  od: string;
  do: string;
  moduli: Moduli;
  dani: DanRed[];
  kif: KifRed[];
  reklamacije: ReklamacijaRed[];
  kuf: KufRed[];
  ulazStavke: UlazStavkaRed[];
  nivelacije: IzvozNivelacijaStavka[];
  kretanjaNovca: IzvozKretanjeNovca[];
  utrosak: UtrosakRed[];
  utrosakZbir: UtrosakZbir[];
  zalihe: ZalihaRed[];
  upozorenja: Upozorenje[];
  zbir: Zbir;
}

const km = (n: number) => n.toFixed(2).replace('.', ',');
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const crtica = (s: string | null | undefined) => (s && s.trim() ? s : '—');

// ── plaćanje ─────────────────────────────────────────────

const VRSTE: Record<string, keyof Placanja> = { gotovina: 'gotovina', kartica: 'kartica', virman: 'virman', cek: 'cek', 'ček': 'cek' };
const NAZIV_VRSTE: Record<keyof Placanja, string> = { gotovina: 'Gotovina', kartica: 'Kartica', virman: 'Virman', cek: 'Ček' };
const nulaPlacanja = (): Placanja => ({ gotovina: 0, kartica: 0, virman: 0, cek: 0 });

/**
 * Način plaćanja → iznosi po vrsti. Tekst ('Kartica') nosi cijeli iznos,
 * JSON ({gotovina, kartica…}) je podijeljeno plaćanje (kao `gotovinskiIznos`
 * u drawer.ts). Nepoznat oblik: sve u gotovinu, `poznat: false` (Kontrola).
 */
export function raspodjelaPlacanja(nacin: string, ukupno: number): { iznosi: Placanja; opis: string; poznat: boolean } {
  const tekst = VRSTE[nacin.trim().toLowerCase()];
  if (tekst) return { iznosi: { ...nulaPlacanja(), [tekst]: ukupno }, opis: NAZIV_VRSTE[tekst], poznat: true };

  let json: unknown = null;
  try { json = JSON.parse(nacin); } catch { /* nije JSON */ }
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const iznosi = nulaPlacanja();
    const opis: string[] = [];
    let poznat = true;
    for (const [k, v] of Object.entries(json)) {
      const vrsta = VRSTE[k.toLowerCase()];
      if (!vrsta || typeof v !== 'number') { poznat = false; break; }
      if (v === 0) continue;
      iznosi[vrsta] = round2(iznosi[vrsta] + v);
      opis.push(`${NAZIV_VRSTE[vrsta]} ${km(v)}`);
    }
    if (poznat && opis.length) return { iznosi, opis: opis.join(' + '), poznat };
  }
  return { iznosi: { ...nulaPlacanja(), gotovina: ukupno }, opis: nacin, poznat: false };
}

// ── računi ───────────────────────────────────────────────

/** Ukupno i PDV su fiskalizovani iznosi računa; stavke samo izdvajaju stopu K. */
function stopeRacuna(r: IzvozRacun, stavke: IzvozStavkaRacuna[]): { stope: Stope; odstupanje: number } {
  const ukupno = round2(r.ukupno);
  const pdvE = round2(r.pdvIznos);
  const iznosK = round2(stavke.filter(s => s.pdvStopa !== 'E').reduce((a, s) => a + iznosStavke(s), 0));
  const zbirStavki = stavke.length ? round2(stavke.reduce((a, s) => a + iznosStavke(s), 0)) : ukupno;
  return { stope: { osnovicaE: round2(ukupno - iznosK - pdvE), pdvE, iznosK, ukupno }, odstupanje: round2(ukupno - zbirStavki) };
}

// 0 ostaje 0 (ne -0): Excel i toEqual ne trebaju „-0,00“.
const minus = (n: number) => (n === 0 ? 0 : -n);
const negiraj = (s: Stope): Stope => ({ osnovicaE: minus(s.osnovicaE), pdvE: minus(s.pdvE), iznosK: minus(s.iznosK), ukupno: minus(s.ukupno) });

function oznakaRacuna(r: IzvozRacun): string {
  return [r.isManual ? 'ručni' : '', r.prilogBroj != null ? `prilog ${r.prilogBroj}` : '', r.status === 'refunded' ? 'reklamiran' : '']
    .filter(Boolean).join(', ');
}

function opisRacuna(r: IzvozRacun): string {
  return `Račun ${r.brojFiskalnogRacuna ?? `#${r.id}`} od ${prikazDatuma(r.createdAt)} (${km(r.ukupno)} KM)`;
}

function saberi<T extends object>(redovi: T[], kljucevi: (keyof T)[]): Record<keyof T, number> {
  const out = {} as Record<keyof T, number>;
  for (const k of kljucevi) out[k] = round2(redovi.reduce((a, r) => a + (r[k] as number), 0));
  return out;
}

const KLJUCEVI_STOPA: (keyof Stope)[] = ['osnovicaE', 'pdvE', 'iznosK', 'ukupno'];
const KLJUCEVI_PLACANJA: (keyof Placanja)[] = ['gotovina', 'kartica', 'virman', 'cek'];

export function obracunaj(
  p: KnjigovodjaPodaci,
  opcije: {
    moduli: Moduli;
    odbacenePraznine?: number[];
    /** Današnji lokalni datum 'YYYY-MM-DD'; period koji ide dalje još traje. */
    danas?: string;
  },
): KnjigovodjaIzvjestaj {
  const { moduli, danas } = opcije;
  const upozorenja: Upozorenje[] = [];
  if (danas && p.do > danas) {
    upozorenja.push({ vrsta: 'nezavrsen', opis: `Period još traje — podaci su do ${prikazDatuma(danas)}, a zalihe i promet nisu konačni` });
  }
  const odstupanja: Upozorenje[] = [];
  const placanjaUpoz: Upozorenje[] = [];

  const stavkePoRacunu = new Map<number, IzvozStavkaRacuna[]>();
  for (const s of p.stavkeRacuna) {
    const lista = stavkePoRacunu.get(s.orderId) ?? [];
    lista.push(s);
    stavkePoRacunu.set(s.orderId, lista);
  }

  const dani = new Map<string, DanRed>();
  const dan = (datum: string): DanRed => {
    let d = dani.get(datum);
    if (!d) {
      d = { datum, brojRacuna: 0, osnovicaE: 0, pdvE: 0, iznosK: 0, ukupno: 0, ...nulaPlacanja(), reklamacije: 0, neto: 0 };
      dani.set(datum, d);
    }
    return d;
  };

  const kif: KifRed[] = p.racuni.map(r => {
    const { stope, odstupanje } = stopeRacuna(r, stavkePoRacunu.get(r.id) ?? []);
    const pl = raspodjelaPlacanja(r.nacinPlacanja, stope.ukupno);
    if (Math.abs(odstupanje) > 0.01) {
      odstupanja.push({ vrsta: 'odstupanje', opis: `${opisRacuna(r)}: zbir stavki odstupa za ${km(odstupanje)} KM` });
    }
    if (!pl.poznat) placanjaUpoz.push({ vrsta: 'placanje', opis: `${opisRacuna(r)}: nepoznat način plaćanja „${r.nacinPlacanja}“, uzeto kao gotovina` });
    const d = dan(r.createdAt.slice(0, 10));
    d.brojRacuna += 1;
    for (const k of KLJUCEVI_STOPA) d[k] += stope[k];
    for (const k of KLJUCEVI_PLACANJA) d[k] += pl.iznosi[k];
    return {
      id: r.id, datum: r.createdAt, fiskalniBroj: r.brojFiskalnogRacuna ?? '', kupac: r.kupacNaziv ?? '', jib: r.kupacIdBroj ?? '',
      ...stope, placanje: pl.opis, datumValute: r.datumValute, oznaka: oznakaRacuna(r),
    };
  });

  const reklamacije: ReklamacijaRed[] = p.reklamacije.map(r => {
    const stope = negiraj(stopeRacuna(r, stavkePoRacunu.get(r.id) ?? []).stope);
    dan((r.refundedAt ?? r.createdAt).slice(0, 10)).reklamacije += stope.ukupno;
    return {
      id: r.id, datum: r.refundedAt ?? '', brojReklamacije: r.brojReklamacije ?? '', fiskalniBroj: r.brojFiskalnogRacuna ?? '',
      datumOriginala: r.createdAt, kupac: r.kupacNaziv ?? '', ...stope, placanje: raspodjelaPlacanja(r.nacinPlacanja, r.ukupno).opis,
    };
  });

  const daniRedovi = [...dani.values()]
    .sort((a, b) => a.datum.localeCompare(b.datum))
    .map(d => {
      const out = { ...d };
      for (const k of [...KLJUCEVI_STOPA, ...KLJUCEVI_PLACANJA, 'reklamacije'] as const) out[k] = round2(out[k]);
      out.neto = round2(out.ukupno + out.reklamacije);
      return out;
    });

  // ── Kontrola fiskalne numeracije ──
  const brojevi = p.racuni.map(r => parseFiskalniBroj(r.brojFiskalnogRacuna)).filter((n): n is number => n !== null);
  for (const n of izracunajPraznine(brojevi, MAX_PRAZNINA, new Set(opcije.odbacenePraznine ?? []))) {
    upozorenja.push({ vrsta: 'praznina', opis: `Nedostaje fiskalni račun br. ${n}` });
  }
  for (const r of p.racuni) {
    if (parseFiskalniBroj(r.brojFiskalnogRacuna) === null) upozorenja.push({ vrsta: 'bezBroja', opis: `${opisRacuna(r)} nema fiskalni broj` });
  }
  upozorenja.push(...odstupanja, ...placanjaUpoz);

  // ── Skladište ──
  const kuf: KufRed[] = [];
  const ulazStavke: UlazStavkaRed[] = [];
  if (moduli.skladiste) {
    for (const pr of p.primke) {
      const stavke = p.primkaStavke.filter(s => s.primkaId === pr.id);
      let fakturna = 0, rabat = 0, zavisni = 0, nabavna = 0, pdv = 0, prodajna = 0, ruc = 0;
      for (const s of stavke) {
        const nv = nabavnaVrijednost(s);
        const pct = pdvStopaPct(s.pdvStopa) / 100;
        fakturna += fakturnaVrijednost(s);
        rabat += rabatIznos(s);
        zavisni += s.zavisniTroskovi || 0;
        nabavna += nv;
        pdv += (fakturnaVrijednost(s) - rabatIznos(s)) * pct;
        const pv = s.cijena * s.kolicina;
        prodajna += pv;
        if (pv > 0) ruc += pv / (1 + pct) - nv;
        ulazStavke.push({
          brojPrimke: pr.brojPrimke, datum: pr.datum, sifra: crtica(s.sifra), naziv: crtica(s.naziv), jm: s.jm ?? '',
          kolicina: s.kolicina, fakturnaCijena: s.nabavnaCijena, rabat: s.rabat, zavisni: s.zavisniTroskovi,
          nabavnaCijena: s.kolicina ? round4(nv / s.kolicina) : 0, prodajnaCijena: s.cijena, pdvStopa: s.pdvStopa,
        });
      }
      kuf.push({
        datum: pr.datum, brojPrimke: pr.brojPrimke, dobavljac: pr.dobavljacNaziv ?? '', dobavljacId: pr.dobavljacId ?? '',
        brojFakture: pr.brojFakture ?? '', fakturna: round2(fakturna), rabat: round2(rabat), zavisni: round2(zavisni),
        nabavna: round2(nabavna), pdv: round2(pdv), prodajna: round2(prodajna), ruc: round2(ruc),
      });
    }
  }
  const nivelacije = moduli.skladiste ? p.nivelacije : [];

  const tipoviZaliha = moduli.proizvodnja ? ['artikal', 'materijal'] : ['artikal'];
  const zalihe: ZalihaRed[] = moduli.skladiste
    ? p.zalihe
      .filter(z => tipoviZaliha.includes(z.tip) && Math.abs(z.kolicina) > 1e-9)
      .map(z => {
        const kolicina = round3(z.kolicina);
        const prosjecna = z.nabavnaKolicina > 0 ? round4(z.nabavnaVrijednost / z.nabavnaKolicina) : 0;
        return {
          sifra: z.sifra, naziv: z.naziv, jm: z.jm ?? '', tip: z.tip, kolicina, prosjecnaNabavna: prosjecna,
          nabavnaVrijednost: round2(kolicina * prosjecna), prodajnaCijena: z.cijena, prodajnaVrijednost: round2(kolicina * z.cijena),
        };
      })
    : [];
  for (const z of zalihe) {
    if (z.kolicina < 0) upozorenja.push({ vrsta: 'minus', opis: `Artikal ${z.sifra} ${z.naziv} je u minusu (${z.kolicina} ${z.jm})` });
  }
  const pozitivne = zalihe.filter(z => z.kolicina > 0);

  // ── Proizvodnja ──
  const utrosak: UtrosakRed[] = moduli.proizvodnja
    ? p.utrosak.map(u => {
      const cijena = u.nabavnaCijena ?? u.prosjecnaNabavna;
      return {
        nalog: `${u.broj}/${u.godina}`, zavrsen: u.zavrsenAt, opis: u.proizvod ? `${u.opis} — ${u.proizvod}` : u.opis,
        sifra: crtica(u.sifra), naziv: crtica(u.naziv), jm: u.jm ?? '', kolicina: u.kolicina,
        nabavnaCijena: round4(cijena), vrijednost: round2(u.kolicina * cijena),
      };
    })
    : [];
  const zbirMaterijala = new Map<string, UtrosakZbir>();
  for (const u of utrosak) {
    const k = `${u.sifra}\u0000${u.naziv}`;
    const z = zbirMaterijala.get(k) ?? { sifra: u.sifra, naziv: u.naziv, jm: u.jm, kolicina: 0, vrijednost: 0 };
    z.kolicina = round3(z.kolicina + u.kolicina);
    z.vrijednost = round2(z.vrijednost + u.vrijednost);
    zbirMaterijala.set(k, z);
  }
  const brojNaloga = moduli.proizvodnja ? new Set(p.utrosak.map(u => u.nalogId)).size : 0;

  const promet = { ...saberi(kif, KLJUCEVI_STOPA), ...saberi(daniRedovi, KLJUCEVI_PLACANJA), brojRacuna: kif.length };
  const rekl = { ...saberi(reklamacije, KLJUCEVI_STOPA), broj: reklamacije.length };

  return {
    od: p.od, do: p.do, moduli,
    dani: daniRedovi, kif, reklamacije,
    kuf, ulazStavke, nivelacije, kretanjaNovca: p.kretanjaNovca,
    utrosak, utrosakZbir: [...zbirMaterijala.values()], zalihe,
    upozorenja,
    zbir: {
      promet,
      reklamacije: rekl,
      neto: round2(promet.ukupno + rekl.ukupno),
      ulaz: { brojPrimki: kuf.length, ...saberi(kuf, ['nabavna', 'pdv', 'prodajna']) },
      nivelacijeRazlika: round2(nivelacije.reduce((a, n) => a + n.ukupnaRazlika, 0)),
      polozi: round2(p.kretanjaNovca.filter(k => k.tip === 'polog').reduce((a, k) => a + k.iznos, 0)),
      povrati: round2(p.kretanjaNovca.filter(k => k.tip === 'povrat').reduce((a, k) => a + k.iznos, 0)),
      utrosak: { brojNaloga, vrijednost: round2(utrosak.reduce((a, u) => a + u.vrijednost, 0)) },
      zalihe: saberi(pozitivne.map(z => ({ nabavna: z.nabavnaVrijednost, prodajna: z.prodajnaVrijednost })), ['nabavna', 'prodajna']),
    },
  };
}
