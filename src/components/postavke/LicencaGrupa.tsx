import LicencaKartica from '@/components/licenca/LicencaKartica';
import { useModuliKontekst } from '@/components/ModuliProvider';
import { NAZIV_MODULA, type Modul } from '@/lib/moduli';
import { cn, porukaGreske } from '@/lib/utils';
import { obavijesti } from '@/lib/dijalog';
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
  const { moduli, postaviModul } = useModuliKontekst();

  const licenciran = (m: Modul) => !!moduli?.licencirani[m];
  // Postavka se čita iz konteksta; navigacija (MainLayout) vidi promjenu bez remounta.
  const postavi = (m: 'proizvodnja' | 'generator') => (v: boolean) =>
    postaviModul(m, v).catch(e => obavijesti(porukaGreske(e)));

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
            checked={!!moduli?.ukljuceni.proizvodnja}
            onChange={postavi('proizvodnja')}
          />
          <PrekidacRed
            id="modul-generator"
            naslov={NAZIV_MODULA.generator}
            opis={<>{OPIS.generator}{moduli && !licenciran('generator') && <NijeULicenci />}</>}
            disabled={!licenciran('generator')}
            checked={!!moduli?.ukljuceni.generator}
            onChange={postavi('generator')}
          />
        </Sekcija>
      </div>
    </div>
  );
}
