import { useEffect, useState } from 'react';
import { GrupaZaglavlje, IshodPoruka, PrekidacRed, Sekcija, type Ishod } from './dijelovi';

type Kljuc =
  | 'kasa.pologPrompt'
  | 'kasa.allowZeroStock'
  | 'kasa.kusurKalkulacija'
  | 'kasa.requirePinRefund'
  | 'kasa.showDailyTotal'
  | 'cijene.unosBezPdv';

/** Postavke koje su uključene dok ih korisnik izričito ne isključi. */
const PODRAZUMIJEVANO_UKLJUCENE: Kljuc[] = ['kasa.pologPrompt', 'kasa.kusurKalkulacija'];

const KLJUCEVI: Kljuc[] = [
  'kasa.pologPrompt', 'kasa.allowZeroStock', 'kasa.kusurKalkulacija',
  'kasa.requirePinRefund', 'kasa.showDailyTotal', 'cijene.unosBezPdv',
];

export default function KasaGrupa() {
  const [vrijednosti, setVrijednosti] = useState<Record<Kljuc, boolean> | null>(null);
  const [pdvPotvrda, setPdvPotvrda] = useState<Ishod>(null);

  useEffect(() => {
    Promise.all(KLJUCEVI.map(k => window.api.getSetting(k))).then((v) => {
      setVrijednosti(Object.fromEntries(KLJUCEVI.map((k, i) => [
        k, PODRAZUMIJEVANO_UKLJUCENE.includes(k) ? v[i] !== 'false' : v[i] === 'true',
      ])) as Record<Kljuc, boolean>);
    });
  }, []);

  useEffect(() => {
    if (!pdvPotvrda) return;
    const t = setTimeout(() => setPdvPotvrda(null), 6000);
    return () => clearTimeout(t);
  }, [pdvPotvrda]);

  const postavi = async (k: Kljuc, v: boolean) => {
    setVrijednosti(s => s && { ...s, [k]: v });
    await window.api.setSetting(k, String(v));
  };

  const p = (k: Kljuc) => ({
    id: `postavka-${k}`,
    checked: vrijednosti?.[k] ?? false,
    disabled: vrijednosti == null,
    onChange: (v: boolean) => postavi(k, v),
  });

  return (
    <div className="pb-6">
      <GrupaZaglavlje naslov="Kasa" opis="Kako se ponaša ekran Kasa i kako se upisuju cijene. Promjene važe odmah." />

      <div className="space-y-4">
        <Sekcija naslov="Tok prodaje">
          <PrekidacRed {...p('kasa.pologPrompt')} naslov="Traži početni polog"
            opis="Nakon prve prijave u danu otvara prozor za unos gotovine u ladici." />
          <PrekidacRed {...p('kasa.allowZeroStock')} naslov="Dozvoli prodaju bez zalihe"
            opis="Artikal koji ima 0 na stanju se ipak može prodati." />
          <PrekidacRed {...p('kasa.kusurKalkulacija')} naslov="Kalkulacija kusura"
            opis="Nakon štampe gotovinskog računa otvara prozor za izračun kusura." />
          <PrekidacRed {...p('kasa.requirePinRefund')} naslov="PIN za storniranje"
            opis="Prije reklamacije računa traži PIN administratora." />
          <PrekidacRed {...p('kasa.showDailyTotal')} naslov="Prikaži dnevni promet"
            opis="Na ekranu Kasa stoji ukupan promet za danas." />
        </Sekcija>

        <Sekcija naslov="Unos cijena" opis="Za artikle, usluge i slobodne stavke">
          <PrekidacRed
            {...p('cijene.unosBezPdv')}
            naslov="Cijenu upisujem bez PDV-a"
            opis="Polje za cijenu kreće na „bez PDV-a“ i aplikacija dodaje 17 % (stopa E). Uz svako polje se može prebaciti na „sa PDV-om“."
            onChange={async (v) => {
              await postavi('cijene.unosBezPdv', v);
              setPdvPotvrda({
                ok: true,
                tekst: `Polje za cijenu od sada kreće na „${v ? 'bez PDV-a' : 'sa PDV-om'}“. Postojeći artikli nisu promijenjeni.`,
              });
            }}
          />
          {pdvPotvrda && <IshodPoruka ishod={pdvPotvrda} className="px-5 pb-3.5 -mt-1" />}
        </Sekcija>
      </div>
    </div>
  );
}
