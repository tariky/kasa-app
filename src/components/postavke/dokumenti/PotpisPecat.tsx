import { Input } from '@/components/ui/input';
import {
  DOKUMENTI_SA_PECATOM, DOKUMENTI_SA_POTPISOM, LIMITI, PECAT_VELICINA, ZADANE_DOKUMENT_POSTAVKE,
  type DokumentPostavke, type DokumentSaPecatom, type DokumentSaPotpisom, type PotpisLinije,
} from '@/lib/dokumentPostavke';
import { POLJE, PrekidacRed, Sekcija, SekcijaTijelo } from '../dijelovi';
import { SlikaBirac, VelicinaSlike } from '../SlikaBirac';

const NAZIV: Record<DokumentSaPotpisom, string> = {
  faktura: 'Faktura', ponuda: 'Ponuda', otpremnica: 'Otpremnica', racun: 'Račun', nalog: 'Radni nalog',
};

const PECAT_NA: Record<DokumentSaPecatom, string> = {
  faktura: 'Pečat na fakturi', ponuda: 'Pečat na ponudi', otpremnica: 'Pečat na otpremnici', racun: 'Pečat na računu',
};

const NASLOV = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400';

/** Slika i veličina pečata, na kojim dokumentima se štampa, i nazivi potpisnih linija. */
export function PotpisPecat({ forma, izmijeni }: {
  forma: DokumentPostavke;
  izmijeni: (fn: (p: DokumentPostavke) => DokumentPostavke) => void;
}) {
  const pecat = (v: Partial<DokumentPostavke['pecat']>) => izmijeni(f => ({ ...f, pecat: { ...f.pecat, ...v } }));
  const potpis = (d: DokumentSaPotpisom, strana: keyof PotpisLinije, v: string) =>
    izmijeni(f => ({ ...f, potpisi: { ...f.potpisi, [d]: { ...f.potpisi[d], [strana]: v } } }));
  const imaSliku = forma.pecat.slika !== '';

  return (
    <Sekcija naslov="Potpis i pečat" opis="Pečat se štampa preko lijeve potpisne linije.">
      <SekcijaTijelo className="space-y-5">
        <SlikaBirac slika={forma.pecat.slika} onChange={slika => pecat({ slika })} accept="image/png,image/jpeg"
          dozvoljeni={{ tipovi: ['image/png', 'image/jpeg'], poruka: 'Pečat mora biti PNG ili JPG.' }}
          alt="Pečat" dodajTekst="Dodaj pečat" zamijeniTekst="Zamijeni pečat"
          napomena="PNG sa providnom pozadinom izgleda najbolje. Širok pečat se smanji da stane iznad potpisa." />
        <VelicinaSlike naslov="Veličina pečata" vrijednost={forma.pecat.velicina} onChange={velicina => pecat({ velicina })}
          min={PECAT_VELICINA.min} max={PECAT_VELICINA.max} zadano={PECAT_VELICINA.zadano} />
      </SekcijaTijelo>

      <div className="border-y border-slate-100">
        {DOKUMENTI_SA_PECATOM.map(d => (
          <PrekidacRed key={d} id={`pecat-${d}`} naslov={PECAT_NA[d]} checked={forma.pecat.na[d]}
            disabled={!imaSliku} opis={!imaSliku && d === 'faktura' ? 'Prvo dodajte sliku pečata.' : undefined}
            onChange={v => izmijeni(f => ({ ...f, pecat: { ...f.pecat, na: { ...f.pecat.na, [d]: v } } }))} />
        ))}
      </div>

      <SekcijaTijelo className="space-y-3">
        <div className="grid grid-cols-[110px_1fr_1fr] items-center gap-x-3 gap-y-2">
          <span className={NASLOV}>Potpisne linije</span>
          <span className={NASLOV}>Lijevo</span>
          <span className={NASLOV}>Desno</span>
          {DOKUMENTI_SA_POTPISOM.map(d => (
            <div key={d} className="contents">
              <span className="text-[13px] text-slate-700">{NAZIV[d]}</span>
              {(['lijevo', 'desno'] as const).map(strana => (
                <Input key={strana} value={forma.potpisi[d][strana]} maxLength={LIMITI.potpis}
                  onChange={e => potpis(d, strana, e.target.value)}
                  aria-label={`${NAZIV[d]}, ${strana} potpis`}
                  placeholder={ZADANE_DOKUMENT_POSTAVKE.potpisi[d][strana]} className={POLJE} />
              ))}
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-slate-400">Prazno polje vraća zadani naziv.</p>
      </SekcijaTijelo>
    </Sekcija>
  );
}
