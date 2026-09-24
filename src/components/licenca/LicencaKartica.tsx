import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { opisLicence, LICENCA_KONTAKT } from '@/lib/licencaTipovi';
import { useLicenca, otvoriLicencaDialog } from '@/hooks/useLicenca';
import { ShieldCheck, ShieldAlert, KeyRound } from 'lucide-react';

function datum(iso: string): string {
  return iso.split('-').reverse().join('.') + '.';
}

/** Kartica "Licenca" u Postavke → Sistem. */
export default function LicencaKartica() {
  const info = useLicenca();
  if (!info) return null;
  const opis = opisLicence(info);
  const licenca = 'licenca' in info ? info.licenca : null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            opis.ton === 'ok' ? 'bg-emerald-50 text-emerald-500' : opis.ton === 'upozorenje' ? 'bg-amber-50 text-amber-500' : 'bg-red-50 text-red-500',
          )}>
            {opis.ton === 'ok' ? <ShieldCheck size={20} /> : <ShieldAlert size={20} />}
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-slate-800">Licenca</h3>
            <p className="text-[12px] text-slate-400 mt-0.5">{opis.naslov}</p>
          </div>
        </div>
      </div>
      <div className="px-6 py-5 space-y-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
          {licenca && (
            <>
              <dt className="text-slate-400">Izdana za</dt>
              <dd className="text-slate-800 font-medium">{licenca.klijent}</dd>
              <dt className="text-slate-400">Važi do</dt>
              <dd className="text-slate-800">{datum(licenca.vrijediDo)}</dd>
            </>
          )}
          <dt className="text-slate-400">ID računara</dt>
          <dd className="text-slate-800 font-mono select-text">{info.uredjaj}</dd>
          <dt className="text-slate-400">Kontakt</dt>
          <dd className="text-slate-800 select-text">
            {LICENCA_KONTAKT.telefon} <span className="text-slate-400">({LICENCA_KONTAKT.telefonNapomena})</span>
            <br />
            {LICENCA_KONTAKT.email}
          </dd>
        </dl>
        {opis.ton !== 'ok' && <p className="text-[13px] text-slate-500">{opis.tekst}</p>}
        <Button onClick={otvoriLicencaDialog} variant="outline" className="h-9 gap-2 text-[13px] border-slate-200">
          <KeyRound size={14} />
          Unesi novi kod
        </Button>
      </div>
    </div>
  );
}
