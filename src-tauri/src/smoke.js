// Smoke test Tauri aplikacije (PAZAR_SMOKE=1, vidi lib.rs): radi u pravom
// webview-u nad privremenom bazom, provjeri spoj renderer ↔ Rust backend i
// osnovni tok kroz UI, pa rezultat pošalje komandi smoke_kraj.
(async () => {
  const provjere = [];
  const ok = (naziv, uslov, detalj) => provjere.push({ naziv, ok: !!uslov, detalj: detalj === undefined ? null : String(detalj) });
  const cekaj = async (fn, ms = 10000) => {
    const kraj = Date.now() + ms;
    while (Date.now() < kraj) {
      try { const r = fn(); if (r) return r; } catch { /* još nije spremno */ }
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  };
  const tekst = () => document.body.innerText;
  const dugme = (t) => [...document.querySelectorAll('button')].find(b => b.innerText.trim() === t);
  const kraj = (greska) => window.__TAURI_INTERNALS__.invoke('smoke_kraj', { rezultat: { provjere, greska: greska ?? null } });

  try {
    ok('window.api postoji', typeof window.api?.login === 'function');

    // Bez licence: ekran aktivacije → samo pregled.
    ok('ekran aktivacije', await cekaj(() => dugme('Nastavi samo za pregled →')));
    dugme('Nastavi samo za pregled →')?.click();

    // Prijava kroz tastaturu na ekranu (PIN 0000).
    ok('ekran prijave', await cekaj(() => dugme('Prijava')));
    for (let i = 0; i < 4; i++) { dugme('0').click(); await new Promise(r => setTimeout(r, 50)); }
    dugme('Prijava').click();
    ok('glavni ekran nakon prijave', await cekaj(() => tekst().includes('Skladište') && tekst().includes('Postavke')));

    // Kanali kroz invoke('api').
    const admin = await window.api.login('0000');
    ok('user:login', admin?.ime === 'Admin' && admin?.uloga === 'admin', JSON.stringify(admin));
    ok('user:login pogrešan PIN → null', (await window.api.login('9999')) === null);

    const { id } = await window.api.createProduct({ sifra: 'SMK1', naziv: 'Smoke artikal', cijena: 2.5, pdvStopa: 'E' });
    ok('product:create', Number.isInteger(id), id);
    const artikli = await window.api.getProducts();
    const a = artikli.find(p => p.id === id);
    ok('product:getAll', a?.naziv === 'Smoke artikal' && a?.stanje === 0 && a?.cijena === 2.5, JSON.stringify(a));

    let greska = null;
    try { await window.api.createProduct({ sifra: 'SMK1', naziv: 'Dupli', cijena: 1, pdvStopa: 'E' }); } catch (e) { greska = e; }
    ok('greška stiže kao Error s porukom', greska instanceof Error && greska.message === 'Artikal sa šifrom "SMK1" već postoji', greska?.message);

    const licenca = await window.api.getLicenca();
    ok('licenca:stanje', licenca?.stanje === 'nema' && /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(licenca?.uredjaj), JSON.stringify(licenca));

    // Licenca blokira kanale koji prave dokumente i javlja događaj rendereru.
    let blokirano = false;
    const odjava = window.api.onLicencaBlokirano(() => { blokirano = true; });
    await new Promise(r => setTimeout(r, 200));
    greska = null;
    try { await window.api.adjustStock(id, 5); } catch (e) { greska = e; }
    ok('licenca blokira product:adjustStock', greska?.message?.startsWith('Licenca je istekla'), greska?.message);
    ok('događaj licenca:blokirano', await cekaj(() => blokirano, 3000));
    odjava();

    const firma = await window.api.getFirmaSettings();
    ok('settings:getFirma', firma?.logoVelicina === 100 && Array.isArray(firma?.bankAccounts), JSON.stringify(firma));
    await window.api.saveFirmaSettings({ naziv: 'Smoke d.o.o.', adresa: 'A', grad: 'Sarajevo', idBroj: '4200000000000', pdvBroj: '', skladiste: '', logo: '' });
    ok('settings:saveFirma', (await window.api.getFirmaSettings()).naziv === 'Smoke d.o.o.');

    const tring = await window.api.getTringSettings();
    ok('settings:getTring', tring?.port === 8085 && tring?.host === 'localhost', JSON.stringify(tring));

    // Tring bez uređaja: odgovor s greškom veze, ne izuzetak.
    const x = await window.api.tringXReport();
    ok('tring:xReport bez uređaja', x?.success === false && typeof x?.error === 'string', JSON.stringify(x));

    // Ekran skladišta prikazuje artikal iz Rust baze.
    dugme('Skladište')?.click() ?? [...document.querySelectorAll('button,a')].find(e => e.innerText.includes('Skladište'))?.click();
    ok('ekran Skladište prikazuje artikal', await cekaj(() => tekst().includes('Smoke artikal')));

    // PDF pregled: window.open(blob:) otvara novi prozor.
    const pdf = new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'], { type: 'application/pdf' });
    const win = window.open(URL.createObjectURL(pdf), '_blank');
    ok('window.open(blob:) vraća prozor', !!win);
    await new Promise(r => setTimeout(r, 1000));

    await kraj();
  } catch (e) {
    await kraj(`${e?.message ?? e}\n${e?.stack ?? ''}`);
  }
})();
