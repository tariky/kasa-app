import type { ReactNode } from 'react';
import { Document, Page, View, Text, StyleSheet, type Styles } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from '../pdf-fonts';
import { kontaktFirme } from '@/lib/firma';
import { PdfPodnozje } from './PdfPodnozje';
import { datumPdf } from './stil';

type Stil = Styles[string];

/** Portret: izvještaj ili zapisnik; pejzaž: gusti obrazac (kalkulacija KCM). */
export type Orijentacija = 'portrait' | 'landscape';

/** Polje zaglavlja: oznaka lijevo, podebljana vrijednost desno; prazno se preskače. */
export type Polje = readonly [oznaka: string, vrijednost: ReactNode] | null | false | undefined;

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;

/** Broj s dvije decimale i zarezom, bez „KM“ — iznosi i količine u izvještajima. */
export const fmt = (n: number) => n.toFixed(2).replace('.', ',');

const s = StyleSheet.create({
  kolonaPolja: { width: '50%' },
  polje: { flexDirection: 'row', marginBottom: 3 },

  /* ── Mreža: debele linije oko zaglavlja i zbira, tanke između redova ── */
  mrezaZaglavlje: { flexDirection: 'row', borderTop: '1pt solid #000', borderBottom: '1pt solid #000' },
  mrezaRed: { flexDirection: 'row', borderBottom: '0.5pt solid #ccc' },
  mrezaZbir: { flexDirection: 'row', borderTop: '1pt solid #000', borderBottom: '1pt solid #000' },

  /* ── Sažetak desno ispod mreže ── */
  sazetakOkvir: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  sazetak: { width: '45%' },
  sazetakRed: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderBottom: '0.5pt solid #eee' },
  sazetakZavrsni: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTop: '1pt solid #000', marginTop: 2 },
  sazetakNaziv: { fontSize: 8 },
  sazetakIznos: { fontSize: 8, fontFamily: FB, fontWeight: 700, textAlign: 'right' },
  bold: { fontFamily: FB, fontWeight: 700 },

  potpisLinija: { borderTop: '0.5pt solid #000', width: '100%' },
});

/** Mjere strane po orijentaciji (pt); pejzažni obrazac je sitniji i zbijeniji. */
const PORTRET = StyleSheet.create({
  strana: { padding: 40, paddingBottom: 60, fontFamily: F, fontSize: 8, color: '#000' },
  // Naslov i podnaslov centrirani jedan ispod drugog.
  naslovBlok: {},
  naslov: { fontSize: 12, fontFamily: FB, fontWeight: 700, textAlign: 'center', marginBottom: 4 },
  podnaslov: { fontSize: 9, textAlign: 'center', marginBottom: 16 },
  polja: { flexDirection: 'row', marginBottom: 16, gap: 20 },
  oznaka: { fontSize: 7, color: '#000', width: 100 },
  vrijednost: { fontSize: 8, fontFamily: FB, fontWeight: 700, flex: 1 },
  potpisRed: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 40 },
  potpis: { width: 180, alignItems: 'center' },
  potpisNaziv: { fontSize: 8, marginBottom: 24 },
});
const PEJZAZ = StyleSheet.create({
  strana: { padding: 25, paddingBottom: 50, fontFamily: F, fontSize: 7, color: '#000' },
  // Naslov lijevo, oznaka obrasca (podnaslov) desno u istom redu.
  naslovBlok: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  naslov: { fontSize: 11, fontFamily: FB, fontWeight: 700, letterSpacing: 0.5 },
  podnaslov: { fontSize: 8, fontFamily: FB, fontWeight: 700 },
  polja: { flexDirection: 'row', marginBottom: 14, gap: 20 },
  oznaka: { fontSize: 6.5, color: '#000', width: 120 },
  vrijednost: { fontSize: 7, fontFamily: FB, fontWeight: 700, flex: 1 },
  potpisRed: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 30 },
  potpis: { width: 160, alignItems: 'center' },
  potpisNaziv: { fontSize: 7, marginBottom: 20 },
});
const STRANA: Record<Orijentacija, Record<keyof typeof PORTRET, Stil>> = { portrait: PORTRET, landscape: PEJZAZ };

/** Podnožje izvještaja: bez linije, sitnije i niže od podnožja A4 dokumenta. */
const PODNOZJE: Record<Orijentacija, { margina: number; dno: number; velicina: number }> = {
  portrait: { margina: 40, dno: 22, velicina: 6.5 },
  landscape: { margina: 25, dno: 18, velicina: 6 },
};

/**
 * Tekstovi s promjenljivim dijelom (naslov, podnaslov, vrijednosti polja i sažetka) se
 * predaju kao JSX po dijelovima (`<>Broj: {broj}</>`), ne kao spojen string: react-pdf
 * kerna svaki dio zasebno, pa bi spojen string drugačije razmakao slova na granici
 * dijelova (npr. „7,“, „(4“).
 */
export interface IzvjestajStranaProps {
  naslov: ReactNode;
  podnaslov: ReactNode;
  /** Naziv firme ide u podnožje svake stranice. */
  firma: { naziv: string };
  /** Dvije kolone polja ispod naslova (lijeva, desna). */
  polja: readonly [lijevo: Polje[], desno: Polje[]];
  orijentacija: Orijentacija;
  /** Potpisna linija desno ispod sadržaja (npr. „Odgovorno lice:“). */
  potpis?: string;
  children: ReactNode;
}

/**
 * Okvir izvještaja (spisak primki, promet, nivelacija, kalkulacija): A4 strana, naslov i
 * podnaslov, dvije kolone polja, sadržaj, potpis i podnožje na svakoj stranici.
 */
export function IzvjestajStrana({ naslov, podnaslov, firma, polja, orijentacija, potpis, children }: IzvjestajStranaProps) {
  const t = STRANA[orijentacija];
  const p = PODNOZJE[orijentacija];
  return (
    <Document>
      <Page size="A4" orientation={orijentacija} style={t.strana}>
        <View style={t.naslovBlok}>
          <Text style={t.naslov}>{naslov}</Text>
          <Text style={t.podnaslov}>{podnaslov}</Text>
        </View>

        <View style={t.polja}>
          {polja.map((kolona, k) => (
            <View key={k} style={s.kolonaPolja}>
              {kolona.map((polje, i) => polje ? (
                <View key={i} style={s.polje}>
                  <Text style={t.oznaka}>{polje[0]}</Text>
                  <Text style={t.vrijednost}>{polje[1]}</Text>
                </View>
              ) : null)}
            </View>
          ))}
        </View>

        {children}

        {potpis ? (
          <View style={t.potpisRed}>
            <View style={t.potpis}>
              <Text style={t.potpisNaziv}>{potpis}</Text>
              <View style={s.potpisLinija} />
            </View>
          </View>
        ) : null}

        <PdfPodnozje firmaNaziv={firma.naziv} danas={datumPdf()} margina={p.margina} dno={p.dno} velicina={p.velicina} linija={false} />
      </Page>
    </Document>
  );
}

/** Firma, adresa i kontakt (web / email, ako ga ima) kao polja zaglavlja. */
export function poljaFirme(firma: { naziv: string; adresa: string; grad: string; web?: string; email?: string }): Polje[] {
  const kontakt = kontaktFirme(firma);
  return [
    ['Firma:', firma.naziv],
    ['Adresa:', <>{firma.adresa}, {firma.grad}</>],
    kontakt ? ['Web / Email:', kontakt] : null,
  ];
}

/** ID i PDV broj firme; prazan broj se preskače. */
export function brojeviFirme(firma: { idBroj: string; pdvBroj: string }): Polje[] {
  return [
    firma.idBroj ? ['ID broj:', firma.idBroj] : null,
    firma.pdvBroj ? ['PDV broj:', firma.pdvBroj] : null,
  ];
}

// ── Mreža ────────────────────────────────────────────────

export interface KolonaMreze<R> {
  /** Ključ kolone u `zbir`. */
  kljuc: string;
  naslov: string;
  /** Udio širine reda, npr. `'12%'`. */
  sirina: `${number}%`;
  /** Poravnanje ćelija u redovima (zadano desno); zaglavlje je uvijek centrirano, a zbir desno. */
  poravnanje?: 'lijevo' | 'sredina' | 'desno';
  vrijednost: (r: R, i: number) => ReactNode;
}

const PORAVNANJE = { lijevo: { textAlign: 'left' }, sredina: { textAlign: 'center' }, desno: {} } as const;

/** Veličine mreže: obična za izvještaje, gusta za pejzažni obrazac sa 17 kolona. */
const MREZA = {
  obicna: StyleSheet.create({
    tabela: { marginBottom: 16 },
    zaglavlje: { fontSize: 6.5, fontFamily: FB, fontWeight: 700, padding: 3, borderRight: '0.5pt solid #999', textAlign: 'center' },
    celija: { fontSize: 7.5, padding: 3, borderRight: '0.5pt solid #ddd', textAlign: 'right' },
    zbir: { fontSize: 7.5, fontFamily: FB, fontWeight: 700, padding: 3, borderRight: '0.5pt solid #999', textAlign: 'right' },
  }),
  gusta: StyleSheet.create({
    tabela: { marginBottom: 10 },
    zaglavlje: { fontSize: 5.5, fontFamily: FB, fontWeight: 700, padding: 3, borderRight: '0.5pt solid #999', textAlign: 'center' },
    celija: { fontSize: 6.5, padding: 2.5, borderRight: '0.5pt solid #ddd', textAlign: 'right' },
    zbir: { fontSize: 6.5, fontFamily: FB, fontWeight: 700, padding: 3, borderRight: '0.5pt solid #999', textAlign: 'right' },
  }),
};

/**
 * Mreža izvještaja: zaglavlje, red po stavci i red zbira (ćelije po ključu kolone; kolone
 * bez zbira ostaju prazne). Kolone su odvojene tankim linijama, zadnja nema desnu.
 */
export function MrezaTabela<R>({ kolone, redovi, zbir, stilReda, gusta = false }: {
  kolone: KolonaMreze<R>[];
  redovi: R[];
  zbir?: Partial<Record<string, ReactNode>>;
  /** Stil svih ćelija reda (npr. storno crvenom). */
  stilReda?: (r: R) => Stil | undefined;
  /** Sitnija slova i gušći redovi (pejzažni obrazac). */
  gusta?: boolean;
}) {
  const m = gusta ? MREZA.gusta : MREZA.obicna;
  const zadnja = kolone.length - 1;
  const sirina = (k: KolonaMreze<R>, j: number): Stil => (j === zadnja ? { width: k.sirina, borderRight: 'none' } : { width: k.sirina });
  return (
    <View style={m.tabela}>
      <View style={s.mrezaZaglavlje}>
        {kolone.map((k, j) => <Text key={k.kljuc} style={[m.zaglavlje, sirina(k, j)]}>{k.naslov}</Text>)}
      </View>

      {redovi.map((r, i) => {
        const stil = stilReda?.(r) ?? {};
        return (
          <View key={i} style={s.mrezaRed}>
            {kolone.map((k, j) => (
              <Text key={k.kljuc} style={[m.celija, sirina(k, j), PORAVNANJE[k.poravnanje ?? 'desno'], stil]}>{k.vrijednost(r, i)}</Text>
            ))}
          </View>
        );
      })}

      {zbir ? (
        <View style={s.mrezaZbir}>
          {kolone.map((k, j) => <Text key={k.kljuc} style={[m.zbir, sirina(k, j)]}>{zbir[k.kljuc]}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

// ── Sažetak ──────────────────────────────────────────────

/** Red sažetka: naziv, iznos i (opciono) stil oba (npr. reklamacije crvenom). */
export type RedSazetka = readonly [naziv: string, iznos: ReactNode, stil?: Stil] | null | false;

/** Sažetak desno ispod mreže (portret): redovi pa podebljan završni red s linijom iznad. */
export function Sazetak({ redovi, ukupno }: { redovi: RedSazetka[]; ukupno: readonly [naziv: string, iznos: ReactNode] }) {
  return (
    <View style={s.sazetakOkvir}>
      <View style={s.sazetak}>
        {redovi.map((r, i) => r ? (
          <View key={i} style={s.sazetakRed}>
            <Text style={[s.sazetakNaziv, r[2] ?? {}]}>{r[0]}</Text>
            <Text style={[s.sazetakIznos, r[2] ?? {}]}>{r[1]}</Text>
          </View>
        ) : null)}
        <View style={s.sazetakZavrsni}>
          <Text style={[s.sazetakNaziv, s.bold]}>{ukupno[0]}</Text>
          <Text style={s.sazetakIznos}>{ukupno[1]}</Text>
        </View>
      </View>
    </View>
  );
}
