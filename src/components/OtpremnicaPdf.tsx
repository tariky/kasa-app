import type { FirmaSettings, Order, OrderItem } from '@/types';
import type { DokumentPostavke } from '@/lib/dokumentPostavke';
import { A4Dokument, DvaBloka, Izdavac, Kupac, MetaRed } from './pdf/A4Dokument';
import { TabelaStavki, type KolonaStavke } from './pdf/TabelaStavki';
import { formatDateTime } from '@/lib/utils';

export interface OtpremnicaPdfProps {
  order: Order;
  firma: FirmaSettings;
  postavke: DokumentPostavke;
}

export function OtpremnicaPdf({ order, firma, postavke }: OtpremnicaPdfProps) {
  const kol = postavke.kolone;

  // Otpremnica ide bez cijena — samo šta je i koliko izdato.
  const kolone: KolonaStavke<OrderItem>[] = [
    { naslov: '#', sirina: '7%', vrijednost: (_, i) => i + 1 },
    { naslov: 'Šifra', sirina: '12%', razmak: { desno: 6 }, sifra: true, vidljiva: kol.sifra, vrijednost: si => si.productSifra ?? '' },
    { naslov: 'Opis', sirina: 'ostatak', bold: true, vrijednost: si => si.productNaziv ?? '' },
    { naslov: 'JM', sirina: '12%', vidljiva: kol.jm, vrijednost: si => si.productJm ?? '' },
    { naslov: 'Količina', sirina: '18%', desno: true, vrijednost: si => si.kolicina },
  ];

  return (
    <A4Dokument
      vrsta="otpremnica" firma={firma} postavke={postavke} ziro
      naslov="OTPREMNICA" broj={`uz račun #${order.brojFiskalnogRacuna || order.id}`}
    >
      <DvaBloka>
        <Izdavac firma={firma} skladiste />
        <Kupac kupac={order} />
      </DvaBloka>

      <MetaRed polja={[
        ['Datum', formatDateTime(order.createdAt)],
        ['Kasir', order.korisnikIme || '—'],
      ]} />

      <TabelaStavki kolone={kolone} redovi={order.stavke ?? []} />
    </A4Dokument>
  );
}
