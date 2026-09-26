import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { POTPIS_AUTORA } from '@/lib/brend';
import { MJERE_ZAGLAVLJA } from './stil';
import { PRIJEVODI } from './prijevodi';

/** Koliko `paddingBottom` stranice raste kad firma ima svoj tekst podnožja (`maxLines` ga reže na 4 reda, i kad su redovi iz `\n`). */
export const DODATAK_PODNOZJA = 24;

const s = StyleSheet.create({
  footer: { position: 'absolute', color: '#999' },
  linija: { borderTop: '0.5pt solid #ccc', paddingTop: 8 },
  tekst: { fontSize: 6.5, color: '#555', lineHeight: 1.35, marginBottom: 4, maxLines: 4, textOverflow: 'ellipsis' },
  red: { flexDirection: 'row', justifyContent: 'space-between' },
});

/** Tekst firme u podnožju (npr. sudski registar); ništa kad ga nema. */
function PodnozjeTekst({ tekst }: { tekst?: string }) {
  return tekst ? <Text style={s.tekst}>{tekst}</Text> : null;
}

/**
 * Podnožje na svakoj stranici: traka `iznad` (ako je ima), tekst firme (ako postoji),
 * pa autor · firma · datum · stranica. Zadane mjere su mjere A4 dokumenta; izvještaji
 * imaju svoju marginu, niže i sitnije podnožje bez linije.
 */
export function PdfPodnozje({
  firmaNaziv, danas, tekst, potpisAutora = POTPIS_AUTORA, generisano = PRIJEVODI.bs.generisano, iznad,
  margina = MJERE_ZAGLAVLJA.margina, dno = 30, velicina = 7, linija = true,
}: {
  firmaNaziv: string; danas: string; tekst?: string; potpisAutora?: string; generisano?: string;
  /** Traka iznad teksta (npr. žiro računi) nosi svoju liniju — tanka linija podnožja tada otpada. */
  iznad?: ReactNode;
  /** Lijevo i desno od ruba stranice — ista kao margina stranice. */
  margina?: number;
  /** Od dna stranice do dna podnožja. */
  dno?: number;
  /** Veličina slova reda autor · firma · stranica. */
  velicina?: number;
  /** Tanka linija iznad podnožja. */
  linija?: boolean;
}) {
  return (
    <View style={[s.footer, { bottom: dno, left: margina, right: margina, fontSize: velicina }, linija && !iznad ? s.linija : {}]} fixed>
      {iznad}
      <PodnozjeTekst tekst={tekst} />
      <View style={s.red}>
        <Text>{potpisAutora}</Text>
        <Text>{firmaNaziv} · {generisano}: {danas}</Text>
        <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </View>
    </View>
  );
}
