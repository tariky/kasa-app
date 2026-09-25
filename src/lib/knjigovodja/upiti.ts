// SQL za kanal izvoz:knjigovodja. Rust backend (src-tauri/backend/src/izvoz.rs)
// čita ovaj fajl include_str!-om i uzima tekst između backtick navodnika, pa se
// taj znak u fajlu smije pojaviti samo oko SQL-a. Parametri su :od i :do
// (YYYY-MM-DD, uključivo); upit koristi samo one koje spominje.
export const UPITI = {
  racuni: `
    SELECT o.id, o.createdAt, o.refundedAt, o.brojFiskalnogRacuna, o.brojReklamacije, o.status,
      o.ukupno, o.pdvIznos, o.nacinPlacanja, o.kupacNaziv, o.kupacIdBroj, o.isManual, o.prilogBroj,
      o.datumValute, u.ime AS korisnikIme
    FROM orders o
    LEFT JOIN users u ON u.id = o.korisnikId
    WHERE date(o.createdAt) BETWEEN :od AND :do
    ORDER BY o.createdAt, o.id
  `,
  reklamacije: `
    SELECT o.id, o.createdAt, o.refundedAt, o.brojFiskalnogRacuna, o.brojReklamacije, o.status,
      o.ukupno, o.pdvIznos, o.nacinPlacanja, o.kupacNaziv, o.kupacIdBroj, o.isManual, o.prilogBroj,
      o.datumValute, u.ime AS korisnikIme
    FROM orders o
    LEFT JOIN users u ON u.id = o.korisnikId
    WHERE o.status = 'refunded' AND date(o.refundedAt) BETWEEN :od AND :do
    ORDER BY o.refundedAt, o.id
  `,
  stavkeRacuna: `
    SELECT x.orderId, x.kolicina, x.cijena, x.rabat, x.pdvStopa
    FROM (
      SELECT oi.id AS rb, 0 AS izvor, oi.orderId, oi.kolicina, oi.cijena, COALESCE(oi.rabat, 0) AS rabat, oi.pdvStopa
      FROM order_items oi
      UNION ALL
      SELECT ps.id, 1, ps.orderId, ps.kolicina, ps.cijena, 0, ps.pdvStopa
      FROM prilog_stavke ps
    ) x
    JOIN orders o ON o.id = x.orderId
    WHERE date(o.createdAt) BETWEEN :od AND :do
      OR (o.status = 'refunded' AND date(o.refundedAt) BETWEEN :od AND :do)
    ORDER BY x.orderId, x.izvor, x.rb
  `,
  primke: `
    SELECT id, brojPrimke, datum, dobavljacNaziv, dobavljacId, brojFakture
    FROM primke
    WHERE date(datum) BETWEEN :od AND :do
    ORDER BY datum, id
  `,
  primkaStavke: `
    SELECT ps.primkaId, p.sifra, p.naziv, p.jm, ps.kolicina, ps.cijena, ps.nabavnaCijena,
      COALESCE(ps.rabat, 0) AS rabat, COALESCE(ps.zavisniTroskovi, 0) AS zavisniTroskovi, ps.pdvStopa
    FROM primka_stavke ps
    JOIN primke pr ON pr.id = ps.primkaId
    LEFT JOIN products p ON p.id = ps.productId
    WHERE date(pr.datum) BETWEEN :od AND :do
    ORDER BY pr.datum, pr.id, ps.id
  `,
  nivelacije: `
    SELECT n.brojNivelacije, n.datum, p.sifra, p.naziv, ns.kolicina, ns.staraCijena, ns.novaCijena,
      ns.razlika, ns.ukupnaRazlika, ns.pdvStopa
    FROM nivelacija_stavke ns
    JOIN nivelacije n ON n.id = ns.nivelacijaId
    LEFT JOIN products p ON p.id = ns.productId
    WHERE date(n.datum) BETWEEN :od AND :do
    ORDER BY n.datum, n.id, ns.id
  `,
  kretanjaNovca: `
    SELECT c.createdAt, c.tip, c.iznos, u.ime AS korisnikIme, c.napomena, c.tringStatus
    FROM cash_movements c
    LEFT JOIN users u ON u.id = c.korisnikId
    WHERE date(c.createdAt) BETWEEN :od AND :do
    ORDER BY c.createdAt, c.id
  `,
  utrosak: `
    SELECT rn.id AS nalogId, rn.broj, rn.godina, rn.zavrsenAt, rn.opis, pp.naziv AS proizvod,
      m.sifra, m.naziv, m.jm, s.kolicina, s.nabavnaCijena,
      COALESCE((
        SELECT SUM(ps.kolicina * ps.nabavnaCijena * (1 - COALESCE(ps.rabat, 0) / 100.0) + COALESCE(ps.zavisniTroskovi, 0))
          / SUM(ps.kolicina)
        FROM primka_stavke ps
        JOIN primke pr ON pr.id = ps.primkaId
        WHERE ps.productId = s.materijalId AND date(pr.datum) <= date(rn.zavrsenAt)
        HAVING SUM(ps.kolicina) > 0
      ), 0) AS prosjecnaNabavna
    FROM radni_nalog_stavke s
    JOIN radni_nalozi rn ON rn.id = s.radniNalogId
    LEFT JOIN products m ON m.id = s.materijalId
    LEFT JOIN products pp ON pp.id = rn.productId
    WHERE rn.status IN ('zavrsen', 'fakturisan') AND date(rn.zavrsenAt) BETWEEN :od AND :do
    ORDER BY rn.zavrsenAt, rn.id, s.id
  `,
  zalihe: `
    SELECT p.sifra, p.naziv, p.jm, p.tip,
      COALESCE((
        SELECT SUM(CASE WHEN sm.tip = 'ulaz' THEN sm.kolicina ELSE -sm.kolicina END)
        FROM stock_movements sm
        WHERE sm.productId = p.id AND date(sm.createdAt) <= :do
      ), 0) AS kolicina,
      COALESCE(
        (SELECT ch.novaCijena FROM cijena_historija ch
          WHERE ch.productId = p.id AND date(ch.createdAt) <= :do ORDER BY ch.id DESC LIMIT 1),
        (SELECT ch.staraCijena FROM cijena_historija ch
          WHERE ch.productId = p.id AND date(ch.createdAt) > :do ORDER BY ch.id LIMIT 1),
        p.cijena
      ) AS cijena,
      COALESCE((
        SELECT SUM(ps.kolicina * ps.nabavnaCijena * (1 - COALESCE(ps.rabat, 0) / 100.0) + COALESCE(ps.zavisniTroskovi, 0))
        FROM primka_stavke ps
        JOIN primke pr ON pr.id = ps.primkaId
        WHERE ps.productId = p.id AND date(pr.datum) <= :do
      ), 0) AS nabavnaVrijednost,
      COALESCE((
        SELECT SUM(ps.kolicina)
        FROM primka_stavke ps
        JOIN primke pr ON pr.id = ps.primkaId
        WHERE ps.productId = p.id AND date(pr.datum) <= :do
      ), 0) AS nabavnaKolicina
    FROM products p
    WHERE p.tip IN ('artikal', 'materijal') AND p.slobodan = 0
    ORDER BY p.sifra
  `,
} as const;
