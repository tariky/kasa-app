import type { ReactNode } from 'react';
import { View, Text, StyleSheet, type Styles } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY_BOLD } from '../pdf-fonts';
import { SifraTekst } from './SifraTekst';

type Stil = Styles[string];

export interface KolonaStavke<R> {
  naslov: string;
  /** Širina u pt, postotak (`'12%'`) ili `'ostatak'` — kolona uzima širinu koja preostane. */
  sirina: number | `${number}%` | 'ostatak';
  desno?: boolean;
  bold?: boolean;
  /** `false` izbacuje kolonu (npr. JM isključen u postavkama, rabat kad ga nema). */
  vidljiva?: boolean;
  /** Šifra se prelama na bilo kojem znaku, bez crtice (vidi `SifraTekst`). */
  sifra?: boolean;
  /** Razmak od susjednih kolona u pt. */
  razmak?: { lijevo?: number; desno?: number };
  vrijednost: (r: R, i: number) => ReactNode;
}

const s = StyleSheet.create({
  tabela: { marginBottom: 20 },
  // Zaglavlje u jednom redu: obična slova bez razmaka (velika + letterSpacing
  // su ~20% šira), a brojčane kolone imaju fiksnu širinu po najdužem naslovu.
  zaglavlje: {
    flexDirection: 'row', alignItems: 'flex-end',
    borderBottom: '1.5pt solid #000', paddingBottom: 5, marginBottom: 2,
  },
  naslov: { fontSize: 7.5, fontFamily: PDF_FONT_FAMILY_BOLD, fontWeight: 700, color: '#555' },
  red: { flexDirection: 'row', paddingVertical: 5, borderBottom: '0.5pt solid #ddd', alignItems: 'flex-start' },
  celija: { fontSize: 8.5, lineHeight: 1.3 },
  celijaBold: { fontSize: 8.5, fontFamily: PDF_FONT_FAMILY_BOLD, fontWeight: 700, lineHeight: 1.3 },
  prazno: { fontSize: 8.5, paddingVertical: 6 },
});

function stilKolone(k: Pick<KolonaStavke<unknown>, 'sirina' | 'razmak' | 'desno'>): Stil {
  const st: Stil = k.sirina === 'ostatak' ? { flex: 1 } : { width: k.sirina };
  if (k.razmak?.lijevo) st.paddingLeft = k.razmak.lijevo;
  if (k.razmak?.desno) st.paddingRight = k.razmak.desno;
  if (k.desno) st.textAlign = 'right';
  return st;
}

/**
 * Tabela stavki A4 dokumenta: zaglavlje s debelom linijom, pa red po stavci.
 * `style`/`zaglavlje` dotjeruju razmake tabele i reda zaglavlja (faktura je zbijenija).
 */
export function TabelaStavki<R>({ kolone, redovi, prazno, style = {}, zaglavlje = {} }: {
  kolone: KolonaStavke<R>[];
  redovi: R[];
  /** Tekst umjesto redova kad stavki nema. */
  prazno?: string;
  style?: Stil;
  zaglavlje?: Stil;
}) {
  const vidljive = kolone.filter(k => k.vidljiva !== false).map(k => ({ k, st: stilKolone(k) }));
  return (
    <View style={[s.tabela, style]}>
      <View style={[s.zaglavlje, zaglavlje]}>
        {vidljive.map(({ k, st }, j) => <Text key={j} style={[s.naslov, st]}>{k.naslov}</Text>)}
      </View>
      {redovi.map((r, i) => (
        <View key={i} style={s.red}>
          {vidljive.map(({ k, st }, j) => {
            const Celija = k.sifra ? SifraTekst : Text;
            return <Celija key={j} style={[k.bold ? s.celijaBold : s.celija, st]}>{k.vrijednost(r, i)}</Celija>;
          })}
        </View>
      ))}
      {prazno && redovi.length === 0 ? <Text style={s.prazno}>{prazno}</Text> : null}
    </View>
  );
}
