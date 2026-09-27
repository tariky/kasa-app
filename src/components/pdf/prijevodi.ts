import { POTPIS_AUTORA, POTPIS_AUTORA_EN } from '@/lib/brend';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import type { PotpisLinije } from '@/lib/dokumentPostavke';

/** Jezik PDF dokumenta; engleski postoji samo za račun. */
export type JezikPdf = 'bs' | 'en';

const bs = {
  invoiceTitle: 'RAČUN',
  refundTitle: 'STORNO',
  seller: 'Izdavač',
  buyer: 'Kupac',
  date: 'Datum',
  dueDate: 'Datum valute',
  cashier: 'Kasir',
  payment: 'Plaćanje',
  colCode: 'Šifra',
  colDescription: 'Opis',
  colUnit: 'JM',
  colQty: 'Kol.',
  colPrice: 'Cijena bez PDV-a',
  colDiscount: 'Rabat',
  colVat: 'PDV',
  colAmount: 'Iznos sa PDV-om',
  subtotal: 'Osnovica',
  vat: `PDV (${PDV_STOPA_E_PCT}%)`,
  total: 'UKUPNO',
  refund: 'Reklamacija',
  refundNumber: 'Broj',
  dateTimeSep: 'u',
  paymentCash: 'Gotovina',
  paymentCard: 'Kartica',

  /* ── Okvir A4 dokumenta ── */
  /** Potpisne linije; `null` — nazivi iz postavki dokumenta (oni su na bosanskom). */
  potpisi: null as PotpisLinije | null,
  generisano: 'Generisano',
  ziroRacuni: 'Žiro računi',
  potpisAutora: POTPIS_AUTORA,
};

/** Tekstovi PDF dokumenata po jeziku: račun i okvir A4 dokumenta (potpisi, podnožje, žiro računi). */
export const PRIJEVODI: Record<JezikPdf, typeof bs> = {
  bs,
  en: {
    invoiceTitle: 'INVOICE',
    refundTitle: 'CREDIT NOTE',
    seller: 'From',
    buyer: 'Bill to',
    date: 'Date',
    dueDate: 'Due date',
    cashier: 'Cashier',
    payment: 'Payment',
    colCode: 'Code',
    colDescription: 'Description',
    colUnit: 'Unit',
    colQty: 'Qty',
    colPrice: 'Price excl. VAT',
    colDiscount: 'Disc.',
    colVat: 'VAT',
    colAmount: 'Amount incl. VAT',
    subtotal: 'Subtotal',
    vat: `VAT (${PDV_STOPA_E_PCT}%)`,
    total: 'TOTAL',
    refund: 'Refund',
    refundNumber: 'Number',
    dateTimeSep: 'at',
    paymentCash: 'Cash',
    paymentCard: 'Card',

    potpisi: { lijevo: 'Issuer signature', desno: 'Recipient signature' },
    generisano: 'Generated',
    ziroRacuni: 'Bank accounts',
    potpisAutora: POTPIS_AUTORA_EN,
  },
};
