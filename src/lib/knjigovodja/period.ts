// Period izvoza za knjigovođu: cijeli mjesec ili od–do (lokalni YYYY-MM-DD,
// uključivo) i ime fajla izvoza.

export const MJESECI = [
  'Januar', 'Februar', 'Mart', 'April', 'Maj', 'Juni',
  'Juli', 'August', 'Septembar', 'Oktobar', 'Novembar', 'Decembar',
] as const;

export interface Period {
  od: string;
  do: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function periodMjeseca(godina: number, mjesec: number): Period {
  const zadnji = new Date(godina, mjesec, 0).getDate();
  return { od: `${godina}-${pad(mjesec)}-01`, do: `${godina}-${pad(mjesec)}-${pad(zadnji)}` };
}

export function prosliMjesec(danas: Date): { godina: number; mjesec: number } {
  const m = danas.getMonth(); // 0 = januar → prošli je decembar prošle godine
  return m === 0 ? { godina: danas.getFullYear() - 1, mjesec: 12 } : { godina: danas.getFullYear(), mjesec: m };
}

/** Period koji pokriva tačno jedan kalendarski mjesec; inače null. */
export function mjesecPerioda(p: Period): { godina: number; mjesec: number } | null {
  const [g, m] = p.od.split('-').map(Number);
  const cijeli = periodMjeseca(g, m);
  return cijeli.od === p.od && cijeli.do === p.do ? { godina: g, mjesec: m } : null;
}

export function prikazDatuma(iso: string): string {
  const [g, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${g}.`;
}

export function prikazPerioda(p: Period): string {
  const mj = mjesecPerioda(p);
  if (mj) return `${MJESECI[mj.mjesec - 1]} ${mj.godina}`;
  if (p.od === p.do) return prikazDatuma(p.od);
  return `${prikazDatuma(p.od)} – ${prikazDatuma(p.do)}`;
}

/** ASCII bez dijakritike i znakova koje Windows/mail ne vole; razmaci → _. */
function ocisti(s: string): string {
  return s
    .replace(/[đĐ]/g, c => (c === 'đ' ? 'd' : 'D'))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[._]+$/, '');
}

export function imeFajla(nazivFirme: string, p: Period): string {
  const mj = mjesecPerioda(p);
  const oznaka = mj ? `${mj.godina}-${pad(mj.mjesec)}` : `${p.od}_${p.do}`;
  const firma = ocisti(nazivFirme);
  return ['Knjigovodja', firma, oznaka].filter(Boolean).join('_');
}
