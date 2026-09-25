import { Button } from '@/components/ui/button';
import { Sekcija, SekcijaPodnozje } from '@/components/postavke/dijelovi';
import { cn } from '@/lib/utils';
import { opisLicence, LICENCA_KONTAKT } from '@/lib/licencaTipovi';
import { useLicenca, otvoriLicencaDialog } from '@/hooks/useLicenca';
import { opisModula } from '@/lib/moduli';
import { KeyRound } from 'lucide-react';

function datum(iso: string): string {
  return iso.split('-').reverse().join('.') + '.';
}

/** Kartica "Licenca" u Postavke → Licenca i moduli. */
export default function LicencaKartica() {
  const info = useLicenca();
  if (!info) return null;
  const opis = opisLicence(info);
  const licenca = 'licenca' in info ? info.licenca : null;

  return (
    <Sekcija naslov="Licenca">
      <div className={cn(
        'flex items-start gap-3 px-5 py-3 border-b border-slate-100',
        opis.ton === 'upozorenje' && 'bg-amber-50/50',
        opis.ton === 'greska' && 'bg-rose-50/50',
      )}>
        <span aria-hidden className={cn(
          'mt-[7px] h-1.5 w-1.5 flex-shrink-0 rounded-full',
          opis.ton === 'ok' ? 'bg-emerald-500' : opis.ton === 'upozorenje' ? 'bg-amber-400' : 'bg-rose-500',
        )} />
        <div className="min-w-0">
          <p className={cn(
            'text-[13px] font-semibold',
            opis.ton === 'ok' ? 'text-slate-800' : opis.ton === 'upozorenje' ? 'text-amber-800' : 'text-rose-700',
          )}>
            {opis.naslov}
          </p>
          {opis.ton !== 'ok' && <p className="mt-0.5 text-[12px] text-slate-500">{opis.tekst}</p>}
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2 px-5 py-4 text-[13px]">
        {licenca && (
          <>
            <dt className="text-slate-400">Izdana za</dt>
            <dd className="text-slate-800 font-medium">{licenca.klijent}</dd>
            <dt className="text-slate-400">Važi do</dt>
            <dd className="text-slate-800 font-mono tabular-nums text-[12.5px]">{datum(licenca.vrijediDo)}</dd>
            <dt className="text-slate-400">Moduli</dt>
            <dd className="text-slate-800">{opisModula(licenca.moduli)}</dd>
          </>
        )}
        <dt className="text-slate-400">ID računara</dt>
        <dd className="text-slate-800 font-mono text-[12.5px] select-text">{info.uredjaj}</dd>
        <dt className="text-slate-400">Produženje</dt>
        <dd className="text-slate-800 select-text">
          {LICENCA_KONTAKT.telefon} <span className="text-slate-400">({LICENCA_KONTAKT.telefonNapomena})</span>
          <br />
          {LICENCA_KONTAKT.email}
        </dd>
      </dl>
      <SekcijaPodnozje>
        <Button onClick={otvoriLicencaDialog} variant="outline" size="sm" className="h-8 gap-1.5 text-[12px] border-slate-200">
          <KeyRound className="h-3.5 w-3.5" />
          Unesi novi kod
        </Button>
        <span className="text-[12px] text-slate-400">Kod se šalje uz ID računara iznad.</span>
      </SekcijaPodnozje>
    </Sekcija>
  );
}
