export const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ime TEXT NOT NULL,
    pin TEXT NOT NULL UNIQUE,
    uloga TEXT NOT NULL CHECK(uloga IN ('admin', 'kasir')),
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sifra TEXT NOT NULL UNIQUE,
    naziv TEXT NOT NULL,
    jm TEXT DEFAULT 'kom',
    cijena REAL NOT NULL,
    pdvStopa TEXT NOT NULL CHECK(pdvStopa IN ('E', 'K')),
    plu INTEGER,
    barkod TEXT,
    tip TEXT NOT NULL DEFAULT 'artikal',
    plocaSirina INTEGER,
    plocaVisina INTEGER,
    slobodan INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    updatedAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS dobavljaci (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL,
    idBroj TEXT,
    pdvBroj TEXT,
    adresa TEXT,
    kontakt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Šifra pod kojom dobavljač vodi artikal (za automatski unos robe s fakture).
  -- Artikal može biti vezan za dobavljača i bez šifre (sifra NULL); jedan
  -- dobavljač ne može istu šifru dati za dva artikla.
  CREATE TABLE IF NOT EXISTS artikal_dobavljac_sifre (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    dobavljacId INTEGER NOT NULL,
    sifra TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE (productId, dobavljacId),
    UNIQUE (dobavljacId, sifra),
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (dobavljacId) REFERENCES dobavljaci(id)
  );

  CREATE TABLE IF NOT EXISTS primke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brojPrimke TEXT NOT NULL UNIQUE,
    datum TEXT NOT NULL,
    dobavljacNaziv TEXT,
    dobavljacId TEXT,
    dobavljacAdresa TEXT,
    brojFakture TEXT,
    napomena TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS primka_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    primkaId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    nabavnaCijena REAL NOT NULL DEFAULT 0,
    rabat REAL NOT NULL DEFAULT 0,
    zavisniTroskovi REAL NOT NULL DEFAULT 0,
    pdvStopa TEXT NOT NULL,
    -- Prodajna cijena koju je ova stavka pregazila BEZ nivelacije (artikal
    -- bez zalihe); NULL = stavka nije tako mijenjala cijenu ili stara primka.
    staraCijena REAL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (primkaId) REFERENCES primke(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS kupci (
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

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korisnikId INTEGER NOT NULL,
    ukupno REAL NOT NULL,
    pdvIznos REAL NOT NULL,
    nacinPlacanja TEXT NOT NULL,
    brojFiskalnogRacuna TEXT,
    brojReklamacije TEXT,
    status TEXT NOT NULL CHECK(status IN ('completed', 'refunded')),
    kupacNaziv TEXT,
    kupacIdBroj TEXT,
    kupacAdresa TEXT,
    kupacGrad TEXT,
    kupacPostanskiBroj TEXT,
    isManual INTEGER NOT NULL DEFAULT 0,
    prilogBroj INTEGER,
    prilogNaziv TEXT,
    datumValute TEXT,
    napomena TEXT,
    refundedAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (korisnikId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    rabat REAL DEFAULT 0,
    pdvStopa TEXT NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS prilog_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    rabat REAL NOT NULL DEFAULT 0,
    pdvStopa TEXT NOT NULL,
    FOREIGN KEY (orderId) REFERENCES orders(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS pending_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    korisnikId INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (korisnikId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS saved_carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL,
    items TEXT NOT NULL,
    ukupno REAL NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS faktura_skice (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    naziv TEXT NOT NULL,
    podaci TEXT NOT NULL,
    ukupno REAL NOT NULL,
    spremljeno TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    tip TEXT NOT NULL CHECK(tip IN ('ulaz', 'izlaz')),
    kolicina REAL NOT NULL,
    referenceType TEXT,
    referenceId INTEGER,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS nivelacije (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brojNivelacije TEXT NOT NULL UNIQUE,
    datum TEXT NOT NULL,
    primkaId INTEGER,
    napomena TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (primkaId) REFERENCES primke(id)
  );

  CREATE TABLE IF NOT EXISTS nivelacija_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nivelacijaId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    staraCijena REAL NOT NULL,
    novaCijena REAL NOT NULL,
    razlika REAL NOT NULL,
    ukupnaRazlika REAL NOT NULL,
    pdvStopa TEXT NOT NULL,
    FOREIGN KEY (nivelacijaId) REFERENCES nivelacije(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  -- Historija promjena prodajne cijene (products.cijena), redom (id). Služi
  -- da poništavanje primke vrati cijenu kakva bi bila da primke nikad nije
  -- bilo: izvor ('primka' | 'rucno'), izvorId = primkaId za primku.
  -- staraCijena je cijena prije ove promjene među izvorima koji još postoje:
  -- kad se prethodna promjena poništi, ovdje se prepiše njena staraCijena.
  -- Promjene prije uvođenja tabele nisu upisane (nema izmišljene historije).
  CREATE TABLE IF NOT EXISTS cijena_historija (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    izvor TEXT NOT NULL CHECK(izvor IN ('primka', 'rucno')),
    izvorId INTEGER,
    staraCijena REAL NOT NULL,
    novaCijena REAL NOT NULL,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS ponude (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broj INTEGER NOT NULL,
    godina INTEGER NOT NULL,
    kupacId INTEGER NOT NULL,
    korisnikId INTEGER NOT NULL,
    datum TEXT NOT NULL,
    vaziDo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft', 'poslana', 'prihvacena', 'odbijena', 'konvertovana')),
    napomena TEXT,
    ukupno REAL NOT NULL,
    pdvIznos REAL NOT NULL,
    racunId INTEGER,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(broj, godina),
    FOREIGN KEY (kupacId) REFERENCES kupci(id),
    FOREIGN KEY (korisnikId) REFERENCES users(id),
    FOREIGN KEY (racunId) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS ponuda_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ponudaId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    cijena REAL NOT NULL,
    rabat REAL NOT NULL DEFAULT 0,
    pdvStopa TEXT NOT NULL,
    FOREIGN KEY (ponudaId) REFERENCES ponude(id),
    FOREIGN KEY (productId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS cash_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tip TEXT NOT NULL CHECK(tip IN ('polog', 'povrat')),
    iznos REAL NOT NULL,
    korisnikId INTEGER NOT NULL,
    tringStatus TEXT NOT NULL CHECK(tringStatus IN ('ok', 'error', 'skipped')),
    napomena TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (korisnikId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS normativi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    productId INTEGER NOT NULL,
    materijalId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    napomena TEXT,
    UNIQUE(productId, materijalId),
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (materijalId) REFERENCES products(id)
  );

  CREATE TABLE IF NOT EXISTS radni_nalozi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broj INTEGER NOT NULL,
    godina INTEGER NOT NULL,
    datum TEXT NOT NULL,
    rok TEXT,
    vrsta TEXT NOT NULL CHECK(vrsta IN ('narudzba', 'zaliha')),
    kupacId INTEGER,
    ponudaId INTEGER,
    opis TEXT NOT NULL,
    productId INTEGER,
    kolicina REAL NOT NULL DEFAULT 1,
    dogovorenaCijena REAL,
    trosakRada REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'otvoren'
      CHECK(status IN ('otvoren', 'u_izradi', 'zavrsen', 'fakturisan')),
    racunId INTEGER,
    korisnikId INTEGER NOT NULL,
    napomena TEXT,
    zavrsenAt TEXT,
    createdAt TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(broj, godina),
    FOREIGN KEY (kupacId) REFERENCES kupci(id),
    FOREIGN KEY (ponudaId) REFERENCES ponude(id),
    FOREIGN KEY (productId) REFERENCES products(id),
    FOREIGN KEY (racunId) REFERENCES orders(id),
    FOREIGN KEY (korisnikId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS radni_nalog_stavke (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    radniNalogId INTEGER NOT NULL,
    materijalId INTEGER NOT NULL,
    kolicina REAL NOT NULL,
    nabavnaCijena REAL,
    napomena TEXT,
    FOREIGN KEY (radniNalogId) REFERENCES radni_nalozi(id),
    FOREIGN KEY (materijalId) REFERENCES products(id)
  );

  CREATE INDEX IF NOT EXISTS idx_cash_movements_createdAt ON cash_movements(createdAt);
  CREATE INDEX IF NOT EXISTS idx_products_sifra ON products(sifra);
  CREATE INDEX IF NOT EXISTS idx_ponuda_stavke_ponudaId ON ponuda_stavke(ponudaId);
  CREATE INDEX IF NOT EXISTS idx_products_barkod ON products(barkod);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_productId ON stock_movements(productId);
  CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);
  CREATE INDEX IF NOT EXISTS idx_order_items_productId ON order_items(productId);
  CREATE INDEX IF NOT EXISTS idx_primka_stavke_primkaId ON primka_stavke(primkaId);
  CREATE INDEX IF NOT EXISTS idx_cijena_historija_product ON cijena_historija(productId, id);
  CREATE INDEX IF NOT EXISTS idx_cijena_historija_izvor ON cijena_historija(izvor, izvorId);
  CREATE INDEX IF NOT EXISTS idx_primka_stavke_productId ON primka_stavke(productId);
  CREATE INDEX IF NOT EXISTS idx_nivelacija_stavke_nivelacijaId ON nivelacija_stavke(nivelacijaId);
  CREATE INDEX IF NOT EXISTS idx_prilog_stavke_orderId ON prilog_stavke(orderId);
  CREATE INDEX IF NOT EXISTS idx_radni_nalog_stavke_nalogId ON radni_nalog_stavke(radniNalogId);
  CREATE INDEX IF NOT EXISTS idx_radni_nalozi_status ON radni_nalozi(status);
  CREATE INDEX IF NOT EXISTS idx_normativi_productId ON normativi(productId);
`;
