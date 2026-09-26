import { formatRucPct, sumePrimke } from '@/lib/izvjestaji';
import { IzvjestajStrana, MrezaTabela, Sazetak, poljaFirme, brojeviFirme, fmt, type KolonaMreze } from './pdf/izvjestaj';

export interface PrimkePdfProps {
  primke: any[];
  dateFrom: string;
  dateTo: string;
  firma: {
    naziv: string;
    adresa: string;
    grad: string;
    idBroj: string;
    pdvBroj: string;
    web?: string;
    email?: string;
    logoVelicina?: number;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (str: string) => {
  if (!str) return '—';
  const dt = new Date(str);
  return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()}`;
};

const KOLONE: KolonaMreze<PrimkePdfProps['primke'][number]>[] = [
  { kljuc: 'rb', naslov: 'Rb', sirina: '5%', poravnanje: 'sredina', vrijednost: (_, i) => i + 1 },
  { kljuc: 'broj', naslov: 'Br. primke', sirina: '12%', poravnanje: 'lijevo', vrijednost: p => p.brojPrimke },
  { kljuc: 'datum', naslov: 'Datum', sirina: '12%', poravnanje: 'lijevo', vrijednost: p => fmtDate(p.datum || p.createdAt) },
  { kljuc: 'dobavljac', naslov: 'Dobavljač', sirina: '18%', poravnanje: 'lijevo', vrijednost: p => p.dobavljacNaziv || '—' },
  { kljuc: 'faktura', naslov: 'Br. fakture', sirina: '13%', poravnanje: 'lijevo', vrijednost: p => p.brojFakture || '—' },
  { kljuc: 'stavki', naslov: 'Stavki', sirina: '8%', poravnanje: 'sredina', vrijednost: p => p.stavke?.length ?? 0 },
  { kljuc: 'nabavna', naslov: 'Nabavna', sirina: '16%', vrijednost: p => fmt(sumePrimke([p]).nabavna) },
  { kljuc: 'prodajna', naslov: 'Prodajna', sirina: '16%', vrijednost: p => fmt(sumePrimke([p]).prodajnaSaPdv) },
];

export function PrimkePdf({ primke, dateFrom, dateTo, firma }: PrimkePdfProps) {
  // RUC kao na kalkulaciji: bez PDV-a, samo artikli (materijal je samo u nabavnoj).
  const ukupno = sumePrimke(primke);

  return (
    <IzvjestajStrana
      orijentacija="portrait" firma={firma}
      naslov="IZVJEŠTAJ O ULAZU ROBE (PRIMKE)" podnaslov={<>Period: {dateFrom} — {dateTo}</>}
      polja={[poljaFirme(firma), brojeviFirme(firma)]}
    >
      <MrezaTabela
        kolone={KOLONE} redovi={primke}
        zbir={{ stavki: 'UKUPNO:', nabavna: fmt(ukupno.nabavna), prodajna: fmt(ukupno.prodajnaSaPdv) }}
      />

      <Sazetak
        redovi={[
          ['Ukupna nabavna vrijednost:', <>{fmt(ukupno.nabavna)} KM</>],
          ['Ukupna prodajna vrijednost:', <>{fmt(ukupno.prodajnaSaPdv)} KM</>],
          ['Broj primki:', primke.length],
        ]}
        ukupno={['RUC:', <>{fmt(ukupno.ruc)} KM ({formatRucPct(ukupno.rucPct)}%)</>]}
      />
    </IzvjestajStrana>
  );
}
