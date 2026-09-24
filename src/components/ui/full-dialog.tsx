// src/components/ui/full-dialog.tsx
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { Eyebrow, Key } from './ledger';

/**
 * Dijalog preko cijelog ekrana za jedan dokument (radni nalog, ulaz robe): tamno zaglavlje
 * s brojem dokumenta, tijelo koje skrola, podnožje sa sljedećim korakom. Esc iz polja prvo
 * napušta polje; tek esc s tijela dijaloga zatvara — zatvaranje uvijek ide kroz onRequestClose
 * da vlasnik može pitati za nespremljene izmjene.
 */
export function FullDialog({ open, onRequestClose, children }: {
  open: boolean; onRequestClose: () => void; children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={v => { if (!v) onRequestClose(); }}>
      {children}
    </DialogPrimitive.Root>
  );
}

export const FullDialogContent = React.forwardRef<HTMLDivElement, {
  onRequestClose: () => void; children: React.ReactNode; className?: string;
}>(function FullDialogContent({ onRequestClose, children, className }, ref) {
  const inner = React.useRef<HTMLDivElement | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    inner.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
  };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0f1629]/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 motion-reduce:animate-none" />
      <DialogPrimitive.Content
        ref={setRef} tabIndex={-1}
        onOpenAutoFocus={e => { e.preventDefault(); inner.current?.focus(); }}
        onEscapeKeyDown={e => {
          e.preventDefault();
          const t = e.target as HTMLElement | null;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
            // Pretraga s upitom sama briše upit; ostala polja samo ispuštaju fokus.
            if (t.getAttribute('role') === 'combobox' && (t as HTMLInputElement).value) return;
            t.blur(); inner.current?.focus(); return;
          }
          onRequestClose();
        }}
        onPointerDownOutside={e => { e.preventDefault(); onRequestClose(); }}
        className={cn(
          'fixed z-50 inset-3 md:inset-5 flex flex-col rounded-2xl bg-white border-2 border-white shadow-2xl shadow-slate-900/40 overflow-hidden outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          'data-[state=open]:zoom-in-[0.985] data-[state=closed]:zoom-out-[0.985] duration-200 motion-reduce:animate-none',
          className,
        )}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export const FullDialogTitle = DialogPrimitive.Title;
export const FullDialogDescription = DialogPrimitive.Description;
export const FullDialogClose = DialogPrimitive.Close;

/** Tamna traka zaglavlja — nosi eyebrow, broj dokumenta, opis i akcije desno. */
export function FullDialogHeader({ eyebrow, title, description, actions, children }: {
  eyebrow: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <header className="flex-shrink-0 bg-[#0f1629] text-white px-6 pt-5 pb-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex items-baseline gap-4 flex-wrap">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45 block">{eyebrow}</span>
            <DialogPrimitive.Title className="text-[26px] font-bold font-mono tracking-tight leading-none mt-1">{title}</DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Description className="text-[13.5px] text-white/70 min-w-0 truncate max-w-[60ch] self-end pb-[3px]">
            {description}
          </DialogPrimitive.Description>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 -mr-2 -mt-1">
          {actions}
          <DialogPrimitive.Close aria-label="Zatvori"
            className="h-8 w-8 flex items-center justify-center rounded-lg text-white/60 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </DialogPrimitive.Close>
        </div>
      </div>
      {children}
    </header>
  );
}

/** Dugme u zaglavlju (na tamnoj podlozi). */
export function HeaderBtn({ icon: Icon, label, hint, onClick }: {
  icon: React.ComponentType<{ size?: number }>; label: string; hint?: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="h-8 flex items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-white/70 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50">
      <Icon size={12} /> {label} {hint && <Key tone="dark">{hint}</Key>}
    </button>
  );
}

export function FullDialogNotice({ type, text, onClose }: { type: 'success' | 'error'; text: string; onClose: () => void }) {
  return (
    <div role="status" className={cn('flex-shrink-0 flex items-center gap-2 px-6 py-2 text-[12px] font-medium border-b',
      type === 'error' ? 'bg-rose-50 border-rose-100 text-rose-700' : 'bg-emerald-50 border-emerald-100 text-emerald-700')}>
      <span aria-hidden>{type === 'error' ? '⚠' : '✓'}</span>
      {text}
      <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Sakrij poruku">✕</button>
    </div>
  );
}

/** Podnožje: legenda prečica lijevo, akcije desno. */
export function FullDialogFooter({ legend, children }: { legend?: React.ReactNode; children: React.ReactNode }) {
  return (
    <footer className="flex-shrink-0 border-t border-slate-200/80 bg-slate-50/60 px-6 py-3 flex items-center justify-between gap-4">
      <div className="hidden md:flex items-center gap-3 text-[10.5px] text-slate-400 whitespace-nowrap">{legend}</div>
      <div className="flex items-center gap-2 ml-auto">{children}</div>
    </footer>
  );
}

/** Dugme u podnožju — isti jezik kao ActionRow, samo u redu umjesto u koloni. */
export function FooterBtn({ icon: Icon, label, hint, tone = 'default', disabled, onClick, title }: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label?: string; hint?: string; tone?: 'primary' | 'default' | 'danger'; disabled?: boolean; onClick: () => void; title?: string;
}) {
  const keyTone = tone === 'primary' ? 'dark' : tone === 'danger' ? 'danger' : 'light';
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={label ?? title}
      className={cn(
        'h-9 flex items-center gap-2 rounded-lg text-[12.5px] font-medium transition-colors duration-150',
        label ? 'px-3' : 'w-9 justify-center',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 disabled:opacity-40 disabled:pointer-events-none',
        tone === 'primary' && 'bg-[#0f1629] text-white hover:bg-[#1b2540] pl-3.5 pr-2.5',
        tone === 'default' && 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300',
        tone === 'danger' && 'text-rose-600 hover:bg-rose-50',
      )}>
      <Icon size={14} strokeWidth={1.75} className="flex-shrink-0" />
      {label && <span>{label}</span>}
      {hint && <Key tone={keyTone} className="ml-0.5">{hint}</Key>}
    </button>
  );
}

/** Jedna činjenica o dokumentu: sitna labela iznad vrijednosti. */
export function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <Eyebrow className="block mb-0.5">{label}</Eyebrow>
      <div className="text-[13px] text-slate-800 leading-snug break-words">{children}</div>
    </div>
  );
}

/** Legenda prečice: keycap + šta radi. */
export function LegendKey({ k, children }: { k: string; children: React.ReactNode }) {
  return <span className="flex items-center gap-1"><Key className="ml-0">{k}</Key> {children}</span>;
}
