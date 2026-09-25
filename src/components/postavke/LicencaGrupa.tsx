import { useEffect, useState } from 'react';
import LicencaKartica from '@/components/licenca/LicencaKartica';
import { useModuli } from '@/hooks/useModuli';
import { NAZIV_MODULA, type Modul } from '@/lib/moduli';
import { cn } from '@/lib/utils';
import { GrupaZaglavlje, PrekidacRed, Red, Sekcija } from './dijelovi';

const OPIS: Record<Modul, string> = {
  skladiste: 'Ulaz robe i stanje zaliha.',
  ponude: 'Ponude kupcima i pretvaranje ponude u račun.',
  proizvodnja: 'Radni nalozi, materijal i normativi. Uključuje ekran Proizvodnja i tip artikla „materijal“.',
  generator: 'Ekran Generator u navigaciji, samo za administratora.',
};

function NijeULicenci() {
  return <span className="block mt-0.5 text-amber-700">Nije uključeno u licencu.</span>;
}

/** Stanje modula koji se ne pali posebno — ide sa licencom. */
function StanjeModula({ ukljucen }: { ukljucen: boolean }) {
  return (
    <span className={cn('flex items-center gap-1.5 text-[12px] font-medium', ukljucen ? 'text-slate-600' : 'text-slate-400')}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', ukljucen ? 'bg-emerald-500' : 'bg-slate-300')} />
      {ukljucen ? 'Uključen' : 'Isključen'}
    </span>
  );
}

export default function LicencaGrupa() {
  const moduli = useModuli();
  const [generator, setGenerator] = useState(false);
  const [proizvodnja, setProizvodnja] = useState(false);

  useEffect(() => {
    window.api.getSetting('ui.showGenerator').then((v) => setGenerator(v === 'true'));
    window.api.getSetting('proizvodnja.enabled').then((v) => setProizvodnja(v === 'true'));
  }, []);

  const licenciran = (m: Modul) => !!moduli?.licencirani[m];

  return (
    <div className="pb-6">
      <GrupaZaglavlje naslov="Licenca i moduli" opis="Šta licenca ovog računara pokriva i koji su dijelovi programa uključeni." />

      <div className="space-y-4">
        <LicencaKartica />

        <Sekcija naslov="Moduli" opis="Kasa, Šifarnik, Računi i Izvještaji su uvijek uključeni.">
          {(['skladiste', 'ponude'] as const).map(m => (
            <Red key={m} naslov={NAZIV_MODULA[m]} opis={<>{OPIS[m]}{moduli && !licenciran(m) && <NijeULicenci />}</>}>
              <StanjeModula ukljucen={licenciran(m)} />
            </Red>
          ))}
          <PrekidacRed
            id="modul-proizvodnja"
            naslov={NAZIV_MODULA.proizvodnja}
            opis={<>{OPIS.proizvodnja}{moduli && !licenciran('proizvodnja') && <NijeULicenci />}</>}
            disabled={!licenciran('proizvodnja')}
            checked={proizvodnja && licenciran('proizvodnja')}
            onChange={async (v) => {
              setProizvodnja(v);
              await window.api.setProizvodnjaEnabled(v);
              window.dispatchEvent(new CustomEvent('ui:proizvodnja', { detail: v }));
            }}
          />
          <PrekidacRed
            id="modul-generator"
            naslov={NAZIV_MODULA.generator}
            opis={<>{OPIS.generator}{moduli && !licenciran('generator') && <NijeULicenci />}</>}
            disabled={!licenciran('generator')}
            checked={generator && licenciran('generator')}
            onChange={async (v) => {
              setGenerator(v);
              await window.api.setSetting('ui.showGenerator', String(v));
              // MainLayout drži navigaciju — obavijesti ga bez remounta
              window.dispatchEvent(new CustomEvent('ui:showGenerator', { detail: v }));
            }}
          />
        </Sekcija>
      </div>
    </div>
  );
}
