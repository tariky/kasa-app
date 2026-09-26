import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { POTPIS_AUTORA } from '@/lib/brend';

/** Koliko `paddingBottom` stranice raste kad firma ima svoj tekst podnožja (`maxLines` ga reže na 4 reda, i kad su redovi iz `\n`). */
export const DODATAK_PODNOZJA = 24;

const s = StyleSheet.create({
  footer: {
    position: 'absolute', bottom: 30, left: 50, right: 50,
    borderTop: '0.5pt solid #ccc', paddingTop: 8, fontSize: 7, color: '#999',
  },
  tekst: { fontSize: 6.5, color: '#555', lineHeight: 1.35, marginBottom: 4, maxLines: 4, textOverflow: 'ellipsis' },
  // Traka iznad (npr. žiro računi) nosi svoju liniju — tanka linija podnožja tada otpada.
  saTrakom: { borderTopWidth: 0, paddingTop: 0 },
  red: { flexDirection: 'row', justifyContent: 'space-between' },
});

/** Tekst firme u podnožju (npr. sudski registar); ništa kad ga nema. Dijele ga i dokumenti s vlastitim podnožjem. */
export function PodnozjeTekst({ tekst }: { tekst?: string }) {
  return tekst ? <Text style={s.tekst}>{tekst}</Text> : null;
}

/**
 * Podnožje na svakoj stranici: traka `iznad` (ako je ima), tekst firme (ako postoji),
 * pa autor · firma · datum · stranica.
 */
export function PdfPodnozje({ firmaNaziv, danas, tekst, potpisAutora = POTPIS_AUTORA, generisano = 'Generisano', iznad }: {
  firmaNaziv: string; danas: string; tekst?: string; potpisAutora?: string; generisano?: string; iznad?: ReactNode;
}) {
  return (
    <View style={[s.footer, iznad ? s.saTrakom : {}]} fixed>
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
