import { View, Text, StyleSheet } from '@react-pdf/renderer';
import type { BankAccount } from '@/types';
import { PDF_FONT_FAMILY_BOLD } from '../pdf-fonts';
import { PRIJEVODI } from './prijevodi';

/** `paddingBottom` stranice kad žiro računi idu u traku iznad podnožja (bez teksta firme). */
export const PODNOZJE_S_RACUNIMA = 118;

const FB = PDF_FONT_FAMILY_BOLD;

const s = StyleSheet.create({
  /* ── U zaglavlju: sporedan podatak uz firmu, ne zaslužuje vlastiti blok ── */
  red: { fontSize: 7.5, color: '#555', marginTop: 1 },

  /* ── U podnožju: zrcali debelu liniju zaglavlja i nosi se na svakoj stranici,
     pa kupac broj za uplatu nađe na istom mjestu kao na memorandumu. ── */
  traka: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderTop: '1pt solid #000', paddingTop: 7, marginBottom: 10,
  },
  naslov: { width: 78, fontSize: 7.5, fontFamily: FB, fontWeight: 700, paddingTop: 0.5, color: '#000' },
  kolona: { flex: 1, paddingLeft: 9, borderLeft: '0.5pt solid #ccc' },
  naziv: { fontSize: 7, color: '#555', marginBottom: 2 },
  broj: { fontSize: 9.5, fontFamily: FB, fontWeight: 700, letterSpacing: 0.4, color: '#000' },
});

/** Redovi „Banka: broj“ ispod adrese firme u zaglavlju. */
export function ZiroRacuniRedovi({ racuni }: { racuni: BankAccount[] }) {
  return (
    <>
      {racuni.map((b, i) => (
        <Text key={i} style={s.red}>{b.bankName}: {b.accountNumber}</Text>
      ))}
    </>
  );
}

/** Traka sa žiro računima iznad podnožja (ide u `PdfPodnozje` kao `iznad`). */
export function ZiroRacuniTraka({ racuni, naslov = PRIJEVODI.bs.ziroRacuni }: { racuni: BankAccount[]; naslov?: string }) {
  return (
    <View style={s.traka}>
      <Text style={s.naslov}>{naslov}</Text>
      {racuni.map((b, i) => (
        <View key={i} style={s.kolona}>
          <Text style={s.naziv}>{b.bankName || '—'}</Text>
          <Text style={s.broj}>{b.accountNumber || '—'}</Text>
        </View>
      ))}
    </View>
  );
}
