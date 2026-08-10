/**
 * Potpis autora u podnožju PDF dokumenata.
 *
 * Jedna konstanta za svih sedam PDF-ova (i svaki budući) — kad se promijeni
 * broj, mijenja se ovdje, a ne u sedam fajlova od kojih se dva zaborave.
 */

export const KONTAKT_TELEFON = '+387 60 320 4600';

/** Bosanski potpis: "Izrađeno programom Pazar · +387 60 320 4600" */
export const POTPIS_AUTORA = `Izrađeno programom Pazar · ${KONTAKT_TELEFON}`;

/** Engleski potpis — koristi ga samo RacunPdf, jedini dvojezični dokument. */
export const POTPIS_AUTORA_EN = `Made with Pazar · ${KONTAKT_TELEFON}`;
