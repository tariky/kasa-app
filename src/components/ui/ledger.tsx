import { cn } from '@/lib/utils';

/**
 * Vizuelni jezik "ledger" ekrana — lista dokumenata lijevo, detalj i akcije desno.
 * Dijele ga Računi i Ponude; drži se ovdje da se dva ekrana ne razidu u sitnicama.
 */

/** Keycap — mono čip koji nosi stvarnu prečicu sa dugmeta pored kojeg stoji. */
export function Key({ children, tone = 'light', className }: {
  children: React.ReactNode;
  tone?: 'light' | 'dark' | 'danger';
  /** Prazan po defaultu — `ml-auto` gura čip na desni rub dugmeta; poništi ga u legendama. */
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        'ml-auto inline-flex h-[17px] min-w-[17px] items-center justify-center rounded border px-[3px]',
        'font-mono text-[9.5px] font-semibold leading-none tracking-normal',
        tone === 'dark' && 'border-white/15 bg-white/10 text-white/60',
        tone === 'light' && 'border-slate-200 bg-slate-50 text-slate-400',
        tone === 'danger' && 'border-rose-200 bg-rose-50 text-rose-400',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Red akcije: glavna radnja + opcioni prateći ikon-button za istu vrstu dokumenta. */
export function ActionRow({
  icon: Icon, label, hint, tone = 'default', disabled, onClick, trailing,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  hint?: string;
  tone?: 'primary' | 'default' | 'danger';
  disabled?: boolean;
  onClick: () => void;
  trailing?: { icon: React.ComponentType<{ size?: number; className?: string }>; onClick: () => void; title: string };
}) {
  const keyTone = tone === 'primary' ? 'dark' : tone === 'danger' ? 'danger' : 'light';
  return (
    <div className="flex items-stretch gap-1.5">
      <button
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'flex-1 h-9 flex items-center gap-2.5 rounded-lg px-3 text-[12.5px] font-medium',
          'transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
          'disabled:opacity-40 disabled:pointer-events-none',
          tone === 'primary' && 'bg-[#0f1629] text-white hover:bg-[#1b2540]',
          tone === 'default' && 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300',
          tone === 'danger' && 'bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300',
        )}
      >
        <Icon size={14} strokeWidth={1.75} className="flex-shrink-0" />
        <span>{label}</span>
        {hint && <Key tone={keyTone}>{hint}</Key>}
      </button>
      {trailing && (
        <button
          onClick={trailing.onClick}
          title={trailing.title}
          aria-label={trailing.title}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400',
            'hover:bg-slate-50 hover:text-slate-600 hover:border-slate-300 transition-colors duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
          )}
        >
          <trailing.icon size={14} />
        </button>
      )}
    </div>
  );
}

/** Sitna uppercase labela iznad grupe — nosi vrstu sadržaja, ne ukras. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400', className)}>
      {children}
    </span>
  );
}

/**
 * Traka filtera sa brojačem uz svaku labelu. Brojač je dio izbora, a ne ukras —
 * pokazuje ima li šta iza filtera prije nego se na njega pređe.
 */
export function SegmentedFilter<T extends string>({
  options, value, onChange, counts,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  counts?: Record<string, number>;
}) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-[6px] px-2.5 h-6 text-[11.5px] font-medium transition-colors duration-150',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
            value === o.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {o.label}
          {counts && <span className="font-mono text-[10px] tabular-nums text-slate-400">{counts[o.id] ?? 0}</span>}
        </button>
      ))}
    </div>
  );
}

/** Zaglavlje ledger tabele — sticky, mono, ista mjera na svim ekranima. */
export function LedgerHead({ columns }: { columns: { label: string; className: string }[] }) {
  return (
    <thead>
      <tr>
        {columns.map(c => (
          <th
            key={c.label}
            className={cn(
              'sticky top-0 z-10 bg-white/90 backdrop-blur-sm border-b border-slate-200/80 py-2.5',
              'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400',
              c.className,
            )}
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
