import { Text } from '@react-pdf/renderer';
import type { ComponentProps } from 'react';

/**
 * Riječ razbijena na znakove s praznim slogom između svaka dva. Textkit prazan slog pretvara u
 * prelomnu tačku nulte širine (glue), pa se šifra lomi na bilo kojem znaku BEZ crtice — crticu
 * ubacuje samo kad lomi između dva neprazna sloga, a crtica u šifri artikla bi zavaravala.
 */
export const prelomNaZnaku = (rijec: string): string[] =>
  Array.from(rijec).flatMap((z, i) => (i ? ['', z] : [z]));

/** Ćelija šifre: duga šifra (npr. barkod od 13 cifara) se prelama u svojoj koloni umjesto da pređe preko naziva. */
export function SifraTekst(props: ComponentProps<typeof Text>) {
  return <Text {...props} hyphenationCallback={prelomNaZnaku} />;
}
