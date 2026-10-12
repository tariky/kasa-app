import type * as Tring from '@/services/tring';
import { round2 } from './novac';
import { raspodjelaPlacanja } from './placanje';

/** Podaci o kupcu kako ih čuvaju ekrani i baza. */
interface KupacUnos {
  idBroj?: string; naziv?: string; adresa?: string; postanskiBroj?: string; grad?: string;
}

function mapKupac(kupac?: KupacUnos): Tring.Kupac | undefined {
  if (!kupac) return undefined;
  return {
    idBroj: kupac.idBroj || '',
    naziv: kupac.naziv || '',
    adresa: kupac.adresa || '',
    postanskiBroj: kupac.postanskiBroj || '',
    grad: kupac.grad || '',
  };
}

/**
 * Stavka može stići iz korpe (`sifra`, `naziv`) ili iz baze preko JOIN-a
 * (`productSifra`, `productNaziv`) — oba oblika se mapiraju isto.
 */
function mapStavka(item: any): Tring.RacunStavka {
  return {
    artikal: {
      sifra: item.sifra || item.productSifra || String(item.productId || ''),
      naziv: item.naziv || item.productNaziv || '',
      jm: item.jm || item.productJm || 'kom',
      cijena: item.cijena,
      stopa: item.pdvStopa || item.stopa || 'E',
      plu: item.plu || item.productPlu || 0,
    },
    kolicina: item.kolicina,
    rabat: item.rabat || 0,
  };
}

export function buildTringRacun(data: any): Tring.Racun {
  const ukupno = round2(data.ukupno || 0);
  const vrstePlacanja: Tring.VrstaPlacanja[] =
    data.vrstePlacanja && data.vrstePlacanja.length > 0
      ? data.vrstePlacanja
      : [{ oznaka: data.nacinPlacanja || 'Gotovina', iznos: ukupno }];

  return {
    stavke: (data.items || data.stavke || []).map(mapStavka),
    vrstePlacanja,
    kupac: mapKupac(data.kupac),
    napomena: data.napomena,
    brojRacuna: data.brojRacuna,
  };
}

const BEZGOTOVINSKE = [['kartica', 'Kartica'], ['virman', 'Virman'], ['cek', 'Cek']] as const;

/**
 * Kako reklamacija vraća novac. Tring traži tačno jednu vrstu plaćanja na
 * reklamaciji (TFS 573), a uređaj smanjuje stanje upravo te vrste:
 *
 * - račun plaćen jednom bezgotovinskom vrstom (virman, kartica, ček) vraća se
 *   na nju, negativnim iznosom računa (uputstvo v3.0.1, 7.4 c) — gotovina u
 *   uređaju se ne dira;
 * - gotovinski, razbijeni ili nepoznat oblik vraća se gotovinom (`Gotovina`/0,
 *   uređaj sam računa iznos). Bezgotovinski dio takvog računa (`pokrice`) iz
 *   ladice ne izlazi, pa se prije storna unese u gotovinu uređaja — inače bi
 *   stanje gotovine na uređaju palo ispod onoga što je u ladici.
 *
 * Ranije je svaki storno išao gotovinom uz unos novca za bezgotovinski dio,
 * po starom Tringovom uputstvu („povrat samo u gotovini“): virman na uređaju
 * se tada nikad nije smanjio. Rust: `povrat_reklamacije` u tring_racun.rs.
 */
export function povratReklamacije(nacinPlacanja: string, ukupno: number): {
  placanje: Tring.VrstaPlacanja; pokrice: number;
} {
  const iznos = round2(ukupno);
  const { iznosi, poznat } = raspodjelaPlacanja(nacinPlacanja, iznos);
  const bezgotovinske = BEZGOTOVINSKE.filter(([k]) => iznosi[k] !== 0);
  if (poznat && iznosi.gotovina === 0 && bezgotovinske.length === 1) {
    return { placanje: { oznaka: bezgotovinske[0][1], iznos: -iznos }, pokrice: 0 };
  }
  const gotovina = poznat ? iznosi.gotovina : 0;
  return { placanje: { oznaka: 'Gotovina', iznos: 0 }, pokrice: Math.max(0, round2(iznos - gotovina)) };
}

export function buildTringReklamacija(data: {
  stavke?: any[]; items?: any[]; kupac?: KupacUnos; brojRacuna: number;
  /** Vrsta povrata (`povratReklamacije`); bez nje gotovinski povrat. */
  placanje?: Tring.VrstaPlacanja;
}): Tring.ReklamiraniRacun {
  return {
    stavke: (data.items || data.stavke || []).map(mapStavka),
    // Gotovinski povrat se uređaju javlja kao Gotovina/0 — tako traži TFS
    // (greška 573 kad vrsta plaćanja fali). Pozitivan iznos bi značio doplatu
    // kupca, ne povrat.
    vrstePlacanja: [data.placanje ?? { oznaka: 'Gotovina', iznos: 0 }],
    kupac: mapKupac(data.kupac),
    brojRacuna: data.brojRacuna,
  };
}
