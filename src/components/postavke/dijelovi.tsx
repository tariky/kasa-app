import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * Zajednički dijelovi ekrana Postavke — ista kartica, red i polje u svakoj grupi,
 * u jeziku ledger ekrana (bijela kartica, zaglavlje s naslovom, redovi s crtom).
 */

export const POLJE = 'h-9 text-[13px] bg-slate-50 border-slate-200';

/** Naslov grupe iznad njenih kartica. */
export function GrupaZaglavlje({ naslov, opis }: { naslov: string; opis: string }) {
  return (
    <header className="mb-5">
      <h2 className="text-[19px] font-semibold tracking-tight text-slate-900">{naslov}</h2>
      <p className="mt-1 text-[13px] text-slate-500">{opis}</p>
    </header>
  );
}

/** Kartica jedne cjeline postavki. Djeca su ili `Red`-ovi ili slobodan sadržaj u `SekcijaTijelo`. */
export function Sekcija({ naslov, opis, akcije, children, className }: {
  naslov: string;
  opis?: string;
  akcije?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 overflow-hidden', className)}>
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100 min-h-[49px]">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-700">{naslov}</h3>
          {opis && <p className="text-[12px] text-slate-400">{opis}</p>}
        </div>
        {akcije && <div className="ml-auto flex items-center gap-2 flex-shrink-0">{akcije}</div>}
      </div>
      {children}
    </section>
  );
}

export function SekcijaTijelo({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>;
}

/** Podnožje kartice s dugmadima i ishodom radnje. */
export function SekcijaPodnozje({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
      {children}
    </div>
  );
}

/** Red postavke: naslov i opis lijevo, kontrola desno. */
export function Red({ naslov, opis, children, htmlFor }: {
  naslov: string;
  opis?: React.ReactNode;
  children: React.ReactNode;
  /** Id kontrole — klik na naslov je onda aktivira. */
  htmlFor?: string;
}) {
  return (
    <div className="flex items-center gap-6 px-5 py-3.5 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-slate-800">{naslov}</label>
        {opis && <div className="mt-0.5 text-[12px] leading-snug text-slate-500">{opis}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

/** Red s prekidačem koji se sprema odmah. */
export function PrekidacRed({ id, naslov, opis, checked, disabled, onChange }: {
  id: string;
  naslov: string;
  opis?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Red naslov={naslov} opis={opis} htmlFor={id}>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </Red>
  );
}

/** Labela i polje forme. */
export function Polje({ label, htmlFor, napomena, className, children }: {
  label: string;
  htmlFor?: string;
  napomena?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5 min-w-0', className)}>
      <Label htmlFor={htmlFor} className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </Label>
      {children}
      {napomena && <p className="text-[11.5px] leading-snug text-slate-400">{napomena}</p>}
    </div>
  );
}

export type Ishod = { ok: boolean; tekst: string } | null;

/** Ishod radnje uz dugme — tačka i tekst, kao ishod štampe u Izvještajima. */
export function IshodPoruka({ ishod, className }: { ishod: Ishod; className?: string }) {
  if (!ishod) return null;
  return (
    <p role="status" className={cn('flex items-start gap-1.5 text-[12px] font-medium', ishod.ok ? 'text-emerald-600' : 'text-rose-600', className)}>
      <span aria-hidden className={cn('mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full', ishod.ok ? 'bg-emerald-500' : 'bg-rose-500')} />
      <span className="min-w-0">{ishod.tekst}</span>
    </p>
  );
}
