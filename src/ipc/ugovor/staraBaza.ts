// Baza kakvu bi imao backup iz starije verzije programa: sve kolone i tabele
// koje migracije naknadno dodaju ovdje nedostaju. Ako se doda nova migracija,
// ovdje se NE dodaje ništa — poenta je da ostane star. Polazna tačka za
// src/database/migrations.test.ts (TS) i migracije.ugovor.test.ts (oba backenda).
export const LEGACY_SCHEMA = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ime TEXT NOT NULL,
    pin TEXT NOT NULL UNIQUE,
    uloga TEXT NOT NULL CHECK(uloga IN ('admin', 'kasir')),
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sifra TEXT NOT NULL UNIQUE,
    naziv TEXT NOT NULL,
    jm TEXT DEFAULT 'kom',
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL CHECK(pdvStopa IN ('E', 'K')),
    plu INTEGER,
    barkod TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE primke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brojPrimke TEXT NOT NULL UNIQUE,
    datum TEXT NOT NULL,
    napomena TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE primka_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    primkaId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korisnikId INTEGER NOT NULL,
    ukupno REAL NOT NULL,
    pdvIznos REAL NOT NULL,
    nacinPlacanja TEXT NOT NULL,
    brojFiskalnogRacuna TEXT,
    brojReklamacije TEXT,
    status TEXT NOT NULL CHECK(status IN ('completed', 'refunded')),
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/**
 * Kasnija stara verzija: kupci, stavke priloga i historija cijena već
 * postoje, ali bez kolona koje su im migracije dodale poslije (kupci: rok,
 * način plaćanja i rabat; prilog_stavke: rabat; cijena_historija: ponistena i
 * cijenaUProdaji — koraci sa samoAkoTabelaPostoji). Pokriva granu „tabela
 * postoji, kolona ne". I ovaj fixture ostaje star.
 */
export const LEGACY_SCHEMA_S_TABELAMA = LEGACY_SCHEMA + `
  CREATE TABLE kupci (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL,
    idBroj TEXT NOT NULL,
    pdvBroj TEXT,
    adresa TEXT,
    postanskiBroj TEXT,
    grad TEXT,
    kontakt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE prilog_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL
  );

  CREATE TABLE cijena_historija (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    izvor TEXT NOT NULL CHECK(izvor IN ('primka', 'rucno')),
    izvorId INTEGER,
    staraCijena REAL NOT NULL,
    novaCijena REAL NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );
`;
