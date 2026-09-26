import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { OProgramuKartica } from '@/components/OProgramu';
import { cn, porukaGreske } from '@/lib/utils';
import { SKALA_KLJUC, SKALE, procitajSkalu, primijeniSkalu, skalaPodrzana } from '@/lib/skala';
import { Download, Upload } from 'lucide-react';
import AutomatskiBackup from './AutomatskiBackup';
import { GrupaZaglavlje, IshodPoruka, Red, Sekcija, SekcijaPodnozje, SekcijaTijelo, type Ishod } from './dijelovi';

export default function SistemGrupa() {
  return (
    <div className="pb-6">
      <GrupaZaglavlje naslov="Sistem" opis="Prikaz na ovom računaru, backup baze podataka i podaci o programu." />
      <div className="space-y-4">
        {skalaPodrzana() && <Prikaz />}
        <AutomatskiBackup />
        <Backup />
        <OProgramuKartica />
      </div>
    </div>
  );
}

function Prikaz() {
  const [skala, setSkala] = useState(1);

  useEffect(() => {
    window.api.getSetting(SKALA_KLJUC).then((v) => setSkala(procitajSkalu(v)));
  }, []);

  return (
    <Sekcija naslov="Prikaz" opis="Važi samo za ovaj računar.">
      <Red naslov="Veličina prikaza" opis="Povećava ili smanjuje cijeli program: tekst, dugmad i razmake.">
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Veličina prikaza">
          {SKALE.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={skala === s}
              onClick={async () => {
                setSkala(s);
                await primijeniSkalu(s);
                await window.api.setSetting(SKALA_KLJUC, String(s));
              }}
              className={cn(
                'rounded-[6px] px-2.5 h-7 text-[12px] font-medium font-mono tabular-nums transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                skala === s ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {Math.round(s * 100)}%
            </button>
          ))}
        </div>
      </Red>
    </Sekcija>
  );
}

function Backup() {
  const [ishod, setIshod] = useState<Ishod>(null);
  const [uvozim, setUvozim] = useState(false);

  const kreiraj = async () => {
    setIshod(null);
    try {
      const putanja = await window.api.backupDatabase();
      if (putanja) setIshod({ ok: true, tekst: `Backup spremljen: ${putanja}` });
    } catch (err) {
      setIshod({ ok: false, tekst: `Backup nije napravljen: ${porukaGreske(err)}` });
    }
  };

  const uvezi = async () => {
    setIshod(null);
    setUvozim(true);
    try {
      const r = await window.api.restoreDatabase();
      if (r) {
        // Main proces restartuje program; poruka stoji do restarta.
        setIshod({ ok: true, tekst: 'Backup uvezen. Program se restartuje…' });
      } else {
        setUvozim(false);
      }
    } catch (err: any) {
      setIshod({ ok: false, tekst: err?.message || 'Backup nije uvezen.' });
      setUvozim(false);
    }
  };

  return (
    <Sekcija naslov="Backup baze podataka" opis="Ručna kopija svih podataka u fajl koji sami odaberete.">
      <SekcijaTijelo>
        <p className="text-[12px] leading-relaxed text-slate-500">
          Uvoz zamjenjuje sve trenutne podatke podacima iz backup-a i restartuje program.
          Kopija trenutne baze se prije zamjene spremi automatski, a backup iz starije
          verzije programa se nadogradi na aktuelnu strukturu.
        </p>
      </SekcijaTijelo>
      <SekcijaPodnozje>
        <Button onClick={kreiraj} variant="outline" size="sm" className="h-8 gap-1.5 text-[12px] border-slate-200">
          <Download className="h-3.5 w-3.5" />
          Kreiraj backup
        </Button>
        <Button onClick={uvezi} disabled={uvozim} variant="outline" size="sm" className="h-8 gap-1.5 text-[12px] border-slate-200">
          <Upload className="h-3.5 w-3.5" />
          {uvozim ? 'Uvoz u toku…' : 'Uvezi backup…'}
        </Button>
        <IshodPoruka ishod={ishod} className="ml-2 flex-1 min-w-[200px] break-all" />
      </SekcijaPodnozje>
    </Sekcija>
  );
}
