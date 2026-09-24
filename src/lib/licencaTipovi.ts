// Konstante i tipovi licence bez Node zavisnosti — smiju se uvesti i u renderer.
import type { Licenca } from './licenca';

/** Koliko dana prije isteka se prikazuje upozorenje. */
export const UPOZORENJE_DANA = 7;
/** Koliko dana nakon isteka program još radi normalno. */
export const PERIOD_MILOSTI_DANA = 15;

export const LICENCA_KONTAKT = {
  telefon: '+387 60 320 4600',
  telefonNapomena: 'Viber, WhatsApp',
  email: 'tarik@lunatik.ba',
};

export type StanjeLicence =
  | { stanje: 'nema' }
  | { stanje: 'neispravna'; razlog: 'format' | 'potpis' | 'uredjaj' }
  | { stanje: 'aktivna'; licenca: Licenca; danaDoIsteka: number }
  | { stanje: 'upozorenje'; licenca: Licenca; danaDoIsteka: number }
  | { stanje: 'milost'; licenca: Licenca; danaDoBlokade: number }
  | { stanje: 'zakljucana'; licenca: Licenca };

/** Stanje kako ga main proces šalje rendereru, s ID-om ovog računara. */
export type LicencaInfo = StanjeLicence & { uredjaj: string };

function datum(iso: string): string {
  const [g, m, d] = iso.split('-');
  return `${d}.${m}.${g}.`;
}

/** "1 dan", "3 dana", "21 dan", "11 dana". */
export function brojDana(n: number): string {
  return `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana'}`;
}

export type TonLicence = 'ok' | 'upozorenje' | 'greska';

/** Naslov i objašnjenje stanja za traku, dialog i Postavke. */
export function opisLicence(s: StanjeLicence): { naslov: string; tekst: string; ton: TonLicence } {
  switch (s.stanje) {
    case 'nema':
      return { naslov: 'Program nije aktiviran', tekst: 'Unesite kod licence da biste mogli izdavati račune i dokumente.', ton: 'greska' };
    case 'neispravna':
      return {
        naslov: 'Licenca nije ispravna',
        tekst: s.razlog === 'uredjaj' ? 'Spremljeni kod je izdan za drugi računar. Unesite novi kod.' : 'Spremljeni kod nije ispravan. Unesite novi kod.',
        ton: 'greska',
      };
    case 'aktivna':
      return { naslov: 'Licenca je aktivna', tekst: `Važi do ${datum(s.licenca.vrijediDo)}`, ton: 'ok' };
    case 'upozorenje':
      return {
        naslov: s.danaDoIsteka === 0 ? 'Licenca ističe danas' : `Licenca ističe za ${brojDana(s.danaDoIsteka)}`,
        tekst: `Važi do ${datum(s.licenca.vrijediDo)} Za produženje unesite novi kod.`,
        ton: 'upozorenje',
      };
    case 'milost':
      return {
        naslov: 'Licenca je istekla',
        tekst: s.danaDoBlokade === 0
          ? 'Danas je zadnji dan rada. Od sutra program radi samo za pregled.'
          : `Program radi još ${brojDana(s.danaDoBlokade)}, nakon toga samo za pregled.`,
        ton: 'greska',
      };
    case 'zakljucana':
      return {
        naslov: 'Licenca je istekla — samo pregled',
        tekst: `Istekla ${datum(s.licenca.vrijediDo)} Pregled i izvještaji rade, novi računi i dokumenti ne.`,
        ton: 'greska',
      };
  }
}
