/**
 * Potpis autora u podnožju PDF dokumenata.
 *
 * Jedna konstanta za svih sedam PDF-ova (i svaki budući) — kad se promijeni
 * broj, mijenja se ovdje, a ne u sedam fajlova od kojih se dva zaborave.
 */

export const KONTAKT_TELEFON = '+387 60 320 4600';

/** Bosanski potpis: "Izrađeno programom Atlas · +387 60 320 4600" */
export const POTPIS_AUTORA = `Izrađeno programom Atlas · ${KONTAKT_TELEFON}`;

/** Engleski potpis — koristi ga samo RacunPdf, jedini dvojezični dokument. */
export const POTPIS_AUTORA_EN = `Made with Atlas · ${KONTAKT_TELEFON}`;

/** Tekst za "O programu" (meni i Postavke → Sistem). */
export const PROGRAM = {
  naziv: 'Atlas',
  opis: 'ERP za biznise',
  moduli: 'Kasa, skladište, narudžbe, ponude, proizvodnja i izvještaji na jednom mjestu.',
  firma: 'Lunatik d.o.o.',
  email: 'tarik@lunatik.ba',
  telefon: KONTAKT_TELEFON,
  telefonNapomena: 'Viber, WhatsApp',
};
