import type * as Tring from '@/services/tring';
import { round2 } from './novac';

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

export function buildTringReklamacija(data: {
  stavke?: any[]; items?: any[]; kupac?: KupacUnos; brojRacuna: number;
}): Tring.ReklamiraniRacun {
  return {
    stavke: (data.items || data.stavke || []).map(mapStavka),
    // Gotovinski povrat se uređaju javlja kao Gotovina/0 — tako traži TFS
    // (greška 573 kad vrsta plaćanja fali). Pozitivan iznos bi značio doplatu
    // kupca, ne povrat.
    vrstePlacanja: [{ oznaka: 'Gotovina', iznos: 0 }],
    kupac: mapKupac(data.kupac),
    brojRacuna: data.brojRacuna,
  };
}
