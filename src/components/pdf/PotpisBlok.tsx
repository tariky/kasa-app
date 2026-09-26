import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY_BOLD } from '../pdf-fonts';
import type { PotpisLinije } from '@/lib/dokumentPostavke';

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto', paddingTop: 40, paddingBottom: 20 },
  blok: { width: '42%', position: 'relative' },
  linija: { borderTop: '0.5pt solid #000', marginBottom: 4 },
  labela: {
    fontSize: 7, fontFamily: PDF_FONT_FAMILY_BOLD, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: 1, color: '#000', textAlign: 'center',
  },
  // Pečat leži preko linije kao pravi otisak — ne gura tekst ispod. Dno slike je 6pt iznad dna
  // bloka (~13.6pt), pa vrh viri ~velicina−7.6pt iznad linije; paddingTop to rezerviše (vidi dolje).
  pecat: { position: 'absolute', left: 0, right: 0, bottom: 6, alignItems: 'center' },
});

/** Dvije potpisne linije; pečat (ako je uključen za dokument) iznad lijeve. */
export function PotpisBlok({ linije, pecat }: { linije: PotpisLinije; pecat?: { slika: string; velicina: number } | null }) {
  return (
    <View style={[s.wrap, pecat ? { paddingTop: Math.max(40, pecat.velicina - 4) } : {}]} wrap={false}>
      <View style={s.blok}>
        {pecat && (
          <View style={s.pecat}>
            <Image src={pecat.slika} style={{ height: pecat.velicina, width: pecat.velicina * 1.6, maxWidth: '100%', objectFit: 'contain' }} />
          </View>
        )}
        <View style={s.linija} />
        <Text style={s.labela}>{linije.lijevo}</Text>
      </View>
      <View style={s.blok}>
        <View style={s.linija} />
        <Text style={s.labela}>{linije.desno}</Text>
      </View>
    </View>
  );
}
