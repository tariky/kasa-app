import { Font } from '@react-pdf/renderer';
import DMSansRegular from '@/assets/fonts/DMSans-Regular.ttf';
import DMSansBold from '@/assets/fonts/DMSans-Bold.ttf';

// Register DM Sans which supports Latin Extended (čćžšđ)
Font.register({
  family: 'DM Sans',
  fonts: [
    { src: DMSansRegular, fontWeight: 400 },
    { src: DMSansBold, fontWeight: 700 },
  ],
});

export const PDF_FONT_FAMILY = 'DM Sans';
export const PDF_FONT_FAMILY_BOLD = 'DM Sans';
