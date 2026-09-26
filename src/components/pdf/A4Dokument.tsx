import type { ReactNode } from 'react';
import { Document, Page, View, Text, Image, StyleSheet, type Styles } from '@react-pdf/renderer';
import type { FirmaSettings } from '@/types';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from '../pdf-fonts';
import { POTPIS_AUTORA, POTPIS_AUTORA_EN } from '@/lib/brend';
import { logoVelicina, kontaktFirme, mjestoZiroRacuna } from '@/lib/firma';
import { pecatZa, type DokumentPostavke, type DokumentSaPotpisom } from '@/lib/dokumentPostavke';
import { PotpisBlok } from './PotpisBlok';
import { PdfPodnozje, DODATAK_PODNOZJA } from './PdfPodnozje';
import { ZiroRacuniRedovi, ZiroRacuniTraka, PODNOZJE_S_RACUNIMA } from './ZiroRacuni';
import { MJERE_ZAGLAVLJA as M } from './stil';
import { formatDate } from '@/lib/utils';

type Stil = Styles[string];

export type VrstaDokumenta = 'racun' | 'ponuda' | 'otpremnica' | 'prilog' | 'nalog';

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
/** Donja margina stranice kad podnožje nema ni tekst firme ni traku sa žiro računima. */
const DNO_STRANICE = 70;

/** Faktura (prilog) potpisuje se i pečatira po postavkama fakture. */
const POTPIS_ZA: Record<VrstaDokumenta, DokumentSaPotpisom> = {
  racun: 'racun', ponuda: 'ponuda', otpremnica: 'otpremnica', prilog: 'faktura', nalog: 'nalog',
};

/** Engleski dijelovi okvira — nazivi iz postavki su na bosanskom, pa su potpisi fiksni prijevodi. */
const EN = {
  potpisi: { lijevo: 'Issuer signature', desno: 'Recipient signature' },
  generisano: 'Generated',
  racuni: 'Bank accounts',
};

const s = StyleSheet.create({
  page: { padding: M.margina, fontFamily: F, fontSize: 9, color: '#000' },

  /* ── Zaglavlje: logo i firma lijevo, naslov desno ── */
  zaglavlje: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: M.razmakIspodZaglavlja,
  },
  logoFirma: { flexDirection: 'row', alignItems: 'center', gap: M.razmakLoga },
  firmaNaziv: { fontSize: M.nazivFirme, fontFamily: FB, fontWeight: 700, letterSpacing: 0.3 },
  firmaRed: { fontSize: M.redFirme, color: '#000', marginTop: 1 },
  naslovBlok: { textAlign: 'right' },
  naslov: { fontSize: M.naslov, fontFamily: FB, fontWeight: 700, letterSpacing: 1 },
  broj: { fontSize: M.broj, color: '#000', marginTop: 2 },
  podnaslov: { fontSize: 7, color: '#000', marginTop: 3 },
  // Faktura nosi broj u naslovu („FAKTURA br. 7“) i vezu s fiskalnim računom ispod.
  brojUNaslovu: { fontSize: M.naslov, fontFamily: F, fontWeight: 400, color: '#000', letterSpacing: 0 },
  podnaslovFakture: {
    fontSize: 8, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.5, color: '#000', marginTop: 4,
  },
  linija: { borderBottom: `${M.debljinaLinije}pt solid #000`, marginBottom: M.razmakIspodLinije },

  /* ── Blokovi Izdavač / Kupac ── */
  dvaBloka: { flexDirection: 'row', justifyContent: 'space-between' },
  blok: { width: '48%' },
  blokNaslov: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1.5, color: '#000', marginBottom: 6,
  },
  blokNaziv: { fontSize: 11, fontFamily: FB, fontWeight: 700, marginBottom: 3 },
  blokRed: { fontSize: 8.5, color: '#000', marginBottom: 1.5 },

  /* ── Red podataka (datum, kasir, plaćanje…) ── */
  meta: { flexDirection: 'row', gap: 40 },
  metaNaslov: {
    fontSize: 7, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: '#000', marginBottom: 3,
  },
  metaVrijednost: { fontSize: 9 },

  /* ── Rekapitulacija ── */
  ukupnoOkvir: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  ukupnoKutija: { width: 220 },
  ukupnoRed: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  ukupnoNaziv: { fontSize: 8.5, color: '#000' },
  ukupnoIznos: { fontSize: 8.5, textAlign: 'right' },
  ukupnoZavrsni: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderTop: '1.5pt solid #000', marginTop: 4,
  },
  ukupnoZavrsniTekst: { fontSize: 11, fontFamily: FB, fontWeight: 700 },

  /* ── Uokviren blok (uslovi, reklamacija, opis posla) ── */
  okvir: { border: '1pt solid #000', padding: 8 },
  okvirNaslov: {
    fontSize: 8, fontFamily: FB, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, marginBottom: 3,
  },
});

export interface A4DokumentProps {
  vrsta: VrstaDokumenta;
  firma: FirmaSettings;
  postavke: DokumentPostavke;
  naslov: string;
  broj: string;
  podnaslov?: ReactNode;
  lang?: 'bs' | 'en';
  /** Dokument prema kupcu nosi žiro račune firme (po `ziroRacuniPozicija`); radni nalog ne. */
  ziro: boolean;
  children: ReactNode;
}

/**
 * Okvir A4 dokumenta: zaglavlje s logom i firmom, naslov i broj, debela linija, sadržaj,
 * potpisi (s pečatom po postavkama) i podnožje na svakoj stranici. Žiro računi idu u
 * zaglavlje ili u traku podnožja, a stranica ostavlja mjesta za podnožje koje ima.
 */
export function A4Dokument({ vrsta, firma, postavke, naslov, broj, podnaslov, lang = 'bs', ziro, children }: A4DokumentProps) {
  const en = lang === 'en';
  const racuni = ziro ? mjestoZiroRacuna(firma) : null;
  const paddingBottom = (racuni === 'podnozje' ? PODNOZJE_S_RACUNIMA : DNO_STRANICE) + (postavke.podnozje ? DODATAK_PODNOZJA : 0);
  const kontakt = kontaktFirme(firma);
  const faktura = vrsta === 'prilog';
  const dok = POTPIS_ZA[vrsta];

  return (
    <Document>
      <Page size="A4" style={[s.page, { paddingBottom }]}>
        <View style={s.zaglavlje}>
          <View style={s.logoFirma}>
            {firma.logo && <Image src={firma.logo} style={{ width: logoVelicina(firma), height: logoVelicina(firma), objectFit: 'contain' }} />}
            <View>
              <Text style={s.firmaNaziv}>{firma.naziv}</Text>
              <Text style={s.firmaRed}>{firma.adresa}, {firma.grad}</Text>
              {kontakt ? <Text style={s.firmaRed}>{kontakt}</Text> : null}
              {racuni === 'zaglavlje' && <ZiroRacuniRedovi racuni={firma.bankAccounts} />}
            </View>
          </View>
          <View style={s.naslovBlok}>
            {faktura ? (
              <Text style={s.naslov}>{`${naslov} `}<Text style={s.brojUNaslovu}>{broj}</Text></Text>
            ) : (
              <>
                <Text style={s.naslov}>{naslov}</Text>
                <Text style={s.broj}>{broj}</Text>
              </>
            )}
            {podnaslov ? <Text style={faktura ? s.podnaslovFakture : s.podnaslov}>{podnaslov}</Text> : null}
          </View>
        </View>

        <View style={s.linija} />

        {children}

        <PotpisBlok linije={en ? EN.potpisi : postavke.potpisi[dok]} pecat={dok === 'nalog' ? null : pecatZa(postavke, dok)} />

        <PdfPodnozje
          firmaNaziv={firma.naziv}
          danas={formatDate(new Date())}
          tekst={postavke.podnozje}
          potpisAutora={en ? POTPIS_AUTORA_EN : POTPIS_AUTORA}
          generisano={en ? EN.generisano : undefined}
          iznad={racuni === 'podnozje' ? <ZiroRacuniTraka racuni={firma.bankAccounts} naslov={en ? EN.racuni : undefined} /> : undefined}
        />
      </Page>
    </Document>
  );
}

// ── Gradivni blokovi sadržaja ────────────────────────────

/** Dva bloka jedan do drugog (Izdavač / Kupac); `razmak` je prostor ispod. */
export function DvaBloka({ razmak = 24, children }: { razmak?: number; children: ReactNode }) {
  return <View style={[s.dvaBloka, { marginBottom: razmak }]}>{children}</View>;
}

export function Blok({ naslov, children }: { naslov: string; children: ReactNode }) {
  return (
    <View style={s.blok}>
      <Text style={s.blokNaslov}>{naslov}</Text>
      {children}
    </View>
  );
}

export function BlokNaziv({ children }: { children: ReactNode }) {
  return <Text style={s.blokNaziv}>{children}</Text>;
}

export function BlokRed({ children }: { children: ReactNode }) {
  return <Text style={s.blokRed}>{children}</Text>;
}

/** Izdavač: firma s adresom; `brojevi` dodaje ID i PDV broj, `skladiste` naziv skladišta. */
export function Izdavac({ firma, naslov = 'Izdavač', brojevi = true, skladiste = false }: {
  firma: FirmaSettings; naslov?: string; brojevi?: boolean; skladiste?: boolean;
}) {
  return (
    <Blok naslov={naslov}>
      <BlokNaziv>{firma.naziv}</BlokNaziv>
      <BlokRed>{firma.adresa}</BlokRed>
      <BlokRed>{firma.grad}</BlokRed>
      {brojevi && firma.idBroj ? <BlokRed>ID: {firma.idBroj}</BlokRed> : null}
      {brojevi && firma.pdvBroj ? <BlokRed>PDV: {firma.pdvBroj}</BlokRed> : null}
      {skladiste && firma.skladiste ? <BlokRed>Skladište: {firma.skladiste}</BlokRed> : null}
    </Blok>
  );
}

export interface KupacNaDokumentu {
  kupacNaziv?: string | null;
  kupacAdresa?: string | null;
  kupacPostanskiBroj?: string | null;
  kupacGrad?: string | null;
  kupacIdBroj?: string | null;
  kupacPdvBroj?: string | null;
}

/**
 * Kupac s adresom i ID brojem; `pdv` dodaje PDV broj. Bez naziva i ID broja ispisuje „—“,
 * osim kad je `crtica` isključena (ponuda tada ostavlja samo naslov bloka).
 */
export function Kupac({ kupac, naslov = 'Kupac', pdv = false, crtica = true }: {
  kupac: KupacNaDokumentu; naslov?: string; pdv?: boolean; crtica?: boolean;
}) {
  const imaKupca = !crtica || kupac.kupacNaziv || kupac.kupacIdBroj;
  return (
    <Blok naslov={naslov}>
      {imaKupca ? (
        <>
          {kupac.kupacNaziv && <BlokNaziv>{kupac.kupacNaziv}</BlokNaziv>}
          {kupac.kupacAdresa && <BlokRed>{kupac.kupacAdresa}</BlokRed>}
          {(kupac.kupacPostanskiBroj || kupac.kupacGrad) && (
            <BlokRed>{[kupac.kupacPostanskiBroj, kupac.kupacGrad].filter(Boolean).join(' ')}</BlokRed>
          )}
          {kupac.kupacIdBroj && <BlokRed>ID: {kupac.kupacIdBroj}</BlokRed>}
          {pdv && kupac.kupacPdvBroj && <BlokRed>PDV: {kupac.kupacPdvBroj}</BlokRed>}
        </>
      ) : (
        <BlokRed>—</BlokRed>
      )}
    </Blok>
  );
}

/** Red podataka dokumenta (naslov iznad vrijednosti); prazna polja se preskaču. */
export function MetaRed({ polja, razmak = 22 }: {
  polja: Array<readonly [string, ReactNode] | null | false | undefined>; razmak?: number;
}) {
  return (
    <View style={[s.meta, { marginBottom: razmak }]}>
      {polja.map((p, i) => p ? (
        <View key={i}>
          <Text style={s.metaNaslov}>{p[0]}</Text>
          <Text style={s.metaVrijednost}>{p[1]}</Text>
        </View>
      ) : null)}
    </View>
  );
}

/** Rekapitulacija desno ispod tabele: redovi (osnovica, PDV) pa podebljan završni red. */
export function Ukupno({ redovi, ukupno }: { redovi: Array<readonly [string, string]>; ukupno: readonly [string, string] }) {
  return (
    <View style={s.ukupnoOkvir}>
      <View style={s.ukupnoKutija}>
        {redovi.map(([naziv, iznos], i) => (
          <View key={i} style={s.ukupnoRed}>
            <Text style={s.ukupnoNaziv}>{naziv}</Text>
            <Text style={s.ukupnoIznos}>{iznos}</Text>
          </View>
        ))}
        <View style={s.ukupnoZavrsni}>
          <Text style={s.ukupnoZavrsniTekst}>{ukupno[0]}</Text>
          <Text style={[s.ukupnoZavrsniTekst, { textAlign: 'right' }]}>{ukupno[1]}</Text>
        </View>
      </View>
    </View>
  );
}

/** Uokviren blok s naslovom (uslovi ponude, reklamacija, opis posla). */
export function Okvir({ naslov, style = {}, children }: { naslov: string; style?: Stil; children: ReactNode }) {
  return (
    <View style={[s.okvir, style]}>
      <Text style={s.okvirNaslov}>{naslov}</Text>
      {children}
    </View>
  );
}
