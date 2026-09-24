import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { LICENCA_KONTAKT, type LicencaInfo } from '@/lib/licencaTipovi';
import { objaviLicencu } from '@/hooks/useLicenca';
import { Copy, Check, Phone, Mail, KeyRound, Loader2 } from 'lucide-react';

interface Props {
  uredjaj: string;
  onAktivirano?: (info: LicencaInfo) => void;
  tamno?: boolean;
}

/** Polje za kod licence, ID uređaja i kontakt — zajedničko dialogu i ekranu aktivacije. */
export default function LicencaForma({ uredjaj, onAktivirano, tamno }: Props) {
  const [kod, setKod] = useState('');
  const [greska, setGreska] = useState('');
  const [radi, setRadi] = useState(false);
  const [kopirano, setKopirano] = useState(false);

  const aktiviraj = async () => {
    setGreska('');
    setRadi(true);
    try {
      const info = await window.api.aktivirajLicencu(kod);
      objaviLicencu(info);
      setKod('');
      onAktivirano?.(info);
    } catch (e: any) {
      // Electron dodaje "Error invoking remote method '…': Error: " ispred poruke.
      setGreska(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    } finally {
      setRadi(false);
    }
  };

  const kopirajId = async () => {
    await navigator.clipboard.writeText(uredjaj);
    setKopirano(true);
    setTimeout(() => setKopirano(false), 1500);
  };

  const blijed = tamno ? 'text-slate-400' : 'text-slate-500';
  const okvir = tamno ? 'border-slate-700/60 bg-slate-800/40' : 'border-slate-200 bg-slate-50';

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="licenca-kod" className={cn('text-[13px]', tamno && 'text-slate-300')}>Kod licence</Label>
        <textarea
          id="licenca-kod"
          value={kod}
          onChange={(e) => { setKod(e.target.value); setGreska(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && kod.trim()) { e.preventDefault(); aktiviraj(); } }}
          placeholder="Zalijepite kod koji ste dobili (PAZAR1.…)"
          rows={3}
          spellCheck={false}
          autoFocus
          className={cn(
            'w-full rounded-lg border px-3 py-2 font-mono text-xs break-all resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/40',
            tamno ? 'border-slate-700 bg-slate-900/60 text-slate-100 placeholder:text-slate-600' : 'border-slate-200 bg-white text-slate-800',
          )}
        />
        {greska && <p className="text-[13px] text-red-500">{greska}</p>}
        <Button onClick={aktiviraj} disabled={!kod.trim() || radi} className="w-full h-10 gap-2">
          {radi ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          Aktiviraj
        </Button>
      </div>

      <div className={cn('rounded-lg border px-4 py-3 text-[13px] space-y-2.5', okvir)}>
        <p className={blijed}>Za novi kod javite se sa ID-om ovog računara:</p>
        <div className="flex items-center justify-between gap-3">
          <span className={cn('font-mono text-[15px] font-semibold tracking-wider', tamno ? 'text-white' : 'text-slate-800')}>{uredjaj}</span>
          <button
            type="button"
            onClick={kopirajId}
            className={cn('flex items-center gap-1.5 text-xs font-medium', tamno ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700')}
          >
            {kopirano ? <Check size={14} /> : <Copy size={14} />}
            {kopirano ? 'Kopirano' : 'Kopiraj'}
          </button>
        </div>
        <div className={cn('space-y-1 pt-1 border-t', tamno ? 'border-slate-700/60' : 'border-slate-200')}>
          <p className={cn('flex items-center gap-2 pt-1.5', tamno ? 'text-slate-200' : 'text-slate-700')}>
            <Phone size={14} className={blijed} />
            <span className="font-medium select-text">{LICENCA_KONTAKT.telefon}</span>
            <span className={blijed}>({LICENCA_KONTAKT.telefonNapomena})</span>
          </p>
          <p className={cn('flex items-center gap-2', tamno ? 'text-slate-200' : 'text-slate-700')}>
            <Mail size={14} className={blijed} />
            <span className="font-medium select-text">{LICENCA_KONTAKT.email}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
