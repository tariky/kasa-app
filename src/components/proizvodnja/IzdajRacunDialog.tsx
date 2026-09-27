import type { RadniNalog } from '@/types';
import { formatBrojNaloga, PRODAJNA_USLUGA } from '@/lib/proizvodnja';
import { formatBrojPonude } from '@/lib/ponuda';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
import FiskalnaNaplataDialog from '@/components/FiskalnaNaplataDialog';

export function IzdajRacunDialog({ open, onOpenChange, nalog, onIzdat, onNezavrseno }: {
  open: boolean; onOpenChange: (v: boolean) => void; nalog: RadniNalog;
  onIzdat: (brojFiskalnog: string | null) => void;
  /** Ishod štampe nije poznat ili je račun već upisan iz dijaloga nezavršenih računa. */
  onNezavrseno: (poruka: string) => void;
}) {
  const { postavke } = useDokumentPostavke();
  const cijena = nalog.dogovorenaCijena ?? 0;

  return (
    <FiskalnaNaplataDialog
      open={open}
      onOpenChange={onOpenChange}
      naslov={`Izdaj račun za ${formatBrojNaloga(nalog, postavke.nalog.broj)}`}
      opis={nalog.ponudaId
        ? `Račun po stavkama ponude ${formatBrojPonude({ broj: nalog.ponudaBroj ?? 0, godina: nalog.ponudaGodina ?? 0 }, postavke.ponuda.broj)}`
        : `Jedna stavka: „${PRODAJNA_USLUGA.naziv}“ po dogovorenoj cijeni`}
      napomena="Račun se štampa na Tring fiskalnom printeru. Provjerite da je printer uključen."
      iznos={cijena}
      zadaniNacin="Gotovina"
      blokada={cijena > 0 ? null : 'Upišite dogovorenu cijenu (Uredi zaglavlje)'}
      onIzdaj={nacin => window.api.izdajRacunZaNalog({ id: nalog.id, nacinPlacanja: nacin })}
      onUspjeh={res => onIzdat(res.brojFiskalnogRacuna ?? null)}
      onNezavrseno={onNezavrseno}
    />
  );
}
