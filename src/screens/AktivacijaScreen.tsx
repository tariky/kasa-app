import appIcon from '@/assets/icon.png';
import LicencaForma from '@/components/licenca/LicencaForma';
import { opisLicence, type LicencaInfo } from '@/lib/licencaTipovi';

interface Props {
  info: LicencaInfo;
  onNastavi: () => void;
}

/** Prvi ekran kad program nema ispravnu licencu. */
export default function AktivacijaScreen({ info, onNastavi }: Props) {
  const opis = opisLicence(info);
  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0f1c] relative overflow-hidden">
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px]" />
      <div className="relative z-10 w-[420px]">
        <div className="text-center mb-7">
          <img src={appIcon} alt="Pazar" className="w-16 h-16 rounded-2xl mb-4 shadow-lg shadow-blue-500/20 mx-auto" />
          <h1 className="text-2xl font-bold text-white tracking-tight">{opis.naslov}</h1>
          <p className="text-sm text-slate-400 mt-1.5">{opis.tekst}</p>
        </div>
        <LicencaForma uredjaj={info.uredjaj} tamno />
        <button onClick={onNastavi} className="w-full mt-5 text-[13px] text-slate-500 hover:text-slate-300 transition-colors">
          Nastavi samo za pregled →
        </button>
      </div>
    </div>
  );
}
