import { Image } from 'lucide-react';
import { MJERE_ZAGLAVLJA as M } from './pdf/stil';

/** A4 širina u pt; prikaz koristi 1pt = 1px pa ga skalira kroz CSS zoom. */
const A4_SIRINA = 595;

interface Props {
  naziv: string;
  adresa: string;
  grad: string;
  kontakt: string;
  logo: string;
  logoVelicina: number;
  zoom?: number;
}

/** Živi prikaz vrha A4 dokumenta — mjere iz `MJERE_ZAGLAVLJA`, iste kao zaglavlje PDF dokumenata. */
export function ZaglavljePrikaz({ naziv, adresa, grad, kontakt, logo, logoVelicina, zoom = 0.8 }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-100 p-3 overflow-hidden">
      <div
        className="bg-white shadow-sm text-black mx-auto"
        style={{ width: A4_SIRINA, padding: `${M.margina}px ${M.margina}px 24px`, zoom, fontSize: 9 }}
      >
        <div className="flex justify-between items-start" style={{ marginBottom: M.razmakIspodZaglavlja }}>
          <div className="flex items-center" style={{ gap: M.razmakLoga }}>
            {logo ? (
              <img src={logo} alt="" style={{ width: logoVelicina, height: logoVelicina, objectFit: 'contain' }} />
            ) : (
              <div
                className="flex items-center justify-center border border-dashed border-slate-300 text-slate-300"
                style={{ width: logoVelicina, height: logoVelicina }}
              >
                <Image size={Math.max(16, logoVelicina / 4)} />
              </div>
            )}
            <div>
              <div style={{ fontSize: M.nazivFirme, fontWeight: 700, letterSpacing: 0.3 }}>{naziv || 'Naziv firme'}</div>
              <div style={{ fontSize: M.redFirme, marginTop: 1 }}>{[adresa, grad].filter(Boolean).join(', ') || 'Adresa, Grad'}</div>
              {kontakt && <div style={{ fontSize: M.redFirme, marginTop: 1 }}>{kontakt}</div>}
            </div>
          </div>
          <div className="text-right">
            <div style={{ fontSize: M.naslov, fontWeight: 700, letterSpacing: 1 }}>RAČUN</div>
            <div style={{ fontSize: M.broj, marginTop: 2 }}>#123</div>
          </div>
        </div>
        <div style={{ borderBottom: `${M.debljinaLinije}px solid #000`, marginBottom: M.razmakIspodLinije }} />
        <div className="flex justify-between">
          {[0, 1].map(i => (
            <div key={i} style={{ width: '48%' }} className="space-y-1">
              <div className="h-1.5 w-12 bg-slate-300 rounded-sm" />
              <div className="h-2 w-32 bg-slate-200 rounded-sm" />
              <div className="h-1.5 w-24 bg-slate-100 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
