import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sekcija } from '@/components/postavke/dijelovi';
import { PROGRAM } from '@/lib/brend';
import { version } from '../../package.json';
import appIcon from '@/assets/icon.png';

const godina = new Date().getFullYear();

function Podaci() {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[13px]">
      <dt className="text-slate-400">Verzija</dt>
      <dd className="text-slate-800">{version}</dd>
      <dt className="text-slate-400">Izradio</dt>
      <dd className="text-slate-800 font-medium">{PROGRAM.firma}</dd>
      <dt className="text-slate-400">Telefon</dt>
      <dd className="text-slate-800 select-text">
        {PROGRAM.telefon} <span className="text-slate-400">({PROGRAM.telefonNapomena})</span>
      </dd>
      <dt className="text-slate-400">Email</dt>
      <dd className="text-slate-800 select-text">{PROGRAM.email}</dd>
    </dl>
  );
}

/**
 * Dialog "O programu". Otvara ga stavka "O programu Atlas" u nativnom meniju
 * (Tauri događaj `meni:o-programu`); Electron ima svoj About panel (main.ts).
 */
export function OProgramuDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const odjava = import('@tauri-apps/api/event').then(({ listen }) => listen('meni:o-programu', () => setOpen(true)));
    return () => { void odjava.then(f => f()); };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <img src={appIcon} alt={PROGRAM.naziv} className="w-16 h-16 mb-2" />
          <DialogTitle className="text-xl">{PROGRAM.naziv}</DialogTitle>
          <DialogDescription className="text-[13px]">{PROGRAM.opis}</DialogDescription>
        </DialogHeader>
        <p className="text-[13px] text-slate-500 text-center">{PROGRAM.moduli}</p>
        <div className="rounded-xl bg-slate-50 px-5 py-4">
          <Podaci />
        </div>
        <p className="text-[11px] text-slate-400 text-center">© {godina} {PROGRAM.firma}</p>
      </DialogContent>
    </Dialog>
  );
}

/** Kartica "O programu" u Postavke → Sistem. */
export function OProgramuKartica() {
  return (
    <Sekcija naslov="O programu">
      <div className="flex items-center gap-3 px-5 pt-4">
        <img src={appIcon} alt="" className="w-10 h-10" />
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-slate-800">{PROGRAM.naziv}</p>
          <p className="text-[12px] text-slate-500">{PROGRAM.opis}</p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-4">
        <p className="text-[12px] text-slate-500">{PROGRAM.moduli}</p>
        <Podaci />
      </div>
    </Sekcija>
  );
}
