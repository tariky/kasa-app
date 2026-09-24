import { cn } from '@/lib/utils';
import { opisLicence, type LicencaInfo } from '@/lib/licencaTipovi';
import { otvoriLicencaDialog } from '@/hooks/useLicenca';
import { AlertTriangle, Lock, KeyRound } from 'lucide-react';

/** Traka iznad sadržaja kad licenca ističe, istekla je ili je nema. */
export default function LicencaTraka({ info }: { info: LicencaInfo | null }) {
  if (!info || info.stanje === 'aktivna') return null;
  const opis = opisLicence(info);
  const zakljucano = info.stanje === 'zakljucana' || info.stanje === 'nema' || info.stanje === 'neispravna';
  const upozorenje = opis.ton === 'upozorenje';

  return (
    <div className={cn(
      'flex items-center gap-3 px-5 py-2.5 border-b text-[13px] no-print',
      upozorenje ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-red-50 border-red-200 text-red-900',
    )}>
      {zakljucano
        ? <Lock size={16} className="shrink-0 text-red-600" />
        : <AlertTriangle size={16} className={cn('shrink-0', upozorenje ? 'text-amber-600' : 'text-red-600')} />}
      <p className="min-w-0 flex-1">
        <span className="font-semibold">{opis.naslov}.</span>{' '}
        <span className="opacity-80">{opis.tekst}</span>
      </p>
      <button
        onClick={otvoriLicencaDialog}
        className={cn(
          'shrink-0 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-white',
          upozorenje ? 'bg-amber-600 hover:bg-amber-700' : 'bg-red-600 hover:bg-red-700',
        )}
      >
        <KeyRound size={13} />
        Unesi novi kod
      </button>
    </div>
  );
}
