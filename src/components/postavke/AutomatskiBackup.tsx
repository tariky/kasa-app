import { useState } from 'react';
import { CloudUpload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBackupInfo } from '@/hooks/useBackup';
import { porukaGreske } from '@/lib/utils';
import { IshodPoruka, Red, Sekcija, SekcijaPodnozje, SekcijaTijelo, type Ishod } from './dijelovi';

function datumVrijeme(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dv = (n: number) => String(n).padStart(2, '0');
  return `${dv(d.getDate())}.${dv(d.getMonth() + 1)}.${d.getFullYear()}. u ${dv(d.getHours())}:${dv(d.getMinutes())}`;
}

/** Sekcija "Automatski backup" u Postavke → Sistem. */
export default function AutomatskiBackup() {
  const { info, osvjezi } = useBackupInfo();
  const [radi, setRadi] = useState(false);
  const [ishod, setIshod] = useState<Ishod>(null);
  if (!info) return null;

  if (!info.aktivan) {
    return (
      <Sekcija naslov="Automatski backup" opis="Šifrovana kopija baze u oblaku svaka 3 sata.">
        <SekcijaTijelo>
          <p className="text-[12px] text-slate-500">Automatski backup nije uključen u licencu</p>
        </SekcijaTijelo>
      </Sekcija>
    );
  }

  const sada = async () => {
    setRadi(true);
    setIshod(null);
    try {
      const i = await window.api.backupSada();
      setIshod(i.greska ? { ok: false, tekst: i.greska } : { ok: true, tekst: 'Backup spremljen.' });
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) });
    } finally {
      setRadi(false);
      osvjezi();
    }
  };
  const uToku = radi || info.uToku;

  return (
    <Sekcija naslov="Automatski backup" opis="Šifrovana kopija baze u oblaku svaka 3 sata.">
      <Red naslov="Bucket"><span className="font-mono text-[12px] text-slate-700 select-text">{info.bucket}</span></Red>
      <Red naslov="Zadnji uspješan"><span className="text-[12px] text-slate-700">{datumVrijeme(info.zadnjiUspjeh)}</span></Red>
      <Red naslov="Sljedeći"><span className="text-[12px] text-slate-700">{uToku ? 'u toku…' : datumVrijeme(info.sljedeci)}</span></Red>
      {info.greska && (
        <Red naslov="Zadnja greška" opis={<span className="text-amber-700 select-text">{info.greska}</span>}>
          <span className="text-[12px] text-slate-500">{datumVrijeme(info.greskaOd)}</span>
        </Red>
      )}
      <SekcijaPodnozje>
        <Button onClick={sada} disabled={uToku} variant="outline" size="sm" className="h-8 gap-1.5 text-[12px] border-slate-200">
          {uToku ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
          Backup sada
        </Button>
        <IshodPoruka ishod={ishod} className="ml-2 flex-1 min-w-[200px]" />
      </SekcijaPodnozje>
    </Sekcija>
  );
}
