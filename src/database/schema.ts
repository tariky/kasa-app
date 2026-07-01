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
    pdvStopa TEXT NOT NULL,
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

  CREATE INDEX IF NOT EXISTS idx_products_sifra ON products(sifra);
  CREATE INDEX IF NOT EXISTS idx_products_barkod ON products(barkod);
  CREATE INDEX IF NOT EXISTS idx_stock_movements_productId ON stock_movements(productId);
  CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId);
  CREATE INDEX IF NOT EXISTS idx_order_items_productId ON order_items(productId);
  CREATE INDEX IF NOT EXISTS idx_primka_stavke_primkaId ON primka_stavke(primkaId);
  CREATE INDEX IF NOT EXISTS idx_primka_stavke_productId ON primka_stavke(productId);
  CREATE INDEX IF NOT EXISTS idx_nivelacija_stavke_nivelacijaId ON nivelacija_stavke(nivelacijaId);
`;
