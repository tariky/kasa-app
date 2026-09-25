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

    // CSP iz tauri.conf.json: inline skripte se ne izvršavaju.
    const povrede = [];
    document.addEventListener('securitypolicyviolation', e => povrede.push(e.violatedDirective));
    const inline = document.createElement('script');
    inline.textContent = 'window.__smokeInline = 1';
    document.head.appendChild(inline);
    await new Promise(r => setTimeout(r, 200));
    ok('CSP blokira inline skriptu', window.__smokeInline === undefined && povrede.some(d => d.startsWith('script-src')), povrede.join(','));

    // Bez licence: ekran aktivacije → samo pregled.
    ok('ekran aktivacije', await cekaj(() => dugme('Nastavi samo za pregled →')));
    dugme('Nastavi samo za pregled →')?.click();

    // Prijava kroz tastaturu na ekranu (PIN 0000, pa strelica „Prijavi se“).
    const prijavi = () => document.querySelector('button[aria-label="Prijavi se"]');
    ok('ekran prijave', await cekaj(() => prijavi() && dugme('0')));
    for (let i = 0; i < 4; i++) { dugme('0').click(); await new Promise(r => setTimeout(r, 50)); }
    await new Promise(r => setTimeout(r, 100));
    prijavi().click();
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

    // Tring: odgovor uređaja (ako neki sluša na 8085, npr. tring-mock-server) ima isti oblik.
    const x = await window.api.tringXReport();
    ok('tring:xReport odgovor', typeof x?.success === 'boolean' && typeof x?.vrstaOdgovora === 'string', JSON.stringify(x));
    // Bez uređaja: greška veze u odgovoru, ne izuzetak.
    await window.api.saveTringSettings({ host: '127.0.0.1', port: 1, operatorId: 0, operatorPassword: '0' });
    const bez = await window.api.tringXReport();
    ok('tring:xReport bez uređaja', bez?.success === false && /ECONNREFUSED/.test(bez?.error) && bez?.statusCode === null, JSON.stringify(bez));

    // Ekran skladišta prikazuje artikal iz Rust baze.
    dugme('Skladište')?.click() ?? [...document.querySelectorAll('button,a')].find(e => e.innerText.includes('Skladište'))?.click();
    ok('ekran Skladište prikazuje artikal', await cekaj(() => tekst().includes('Smoke artikal')));

    // PDF pregled: window.open(blob:) otvara novi prozor.
    const pdf = new Blob(['%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'], { type: 'application/pdf' });
    const win = window.open(URL.createObjectURL(pdf), '_blank');
    ok('window.open(blob:) vraća prozor', !!win);
    await new Promise(r => setTimeout(r, 1000));
    // PDF prozor ne smije napustiti svoj blob: (on_navigation u lib.rs).
    let pdfUrl;
    try {
      win.location.href = 'https://example.com/';
      await new Promise(r => setTimeout(r, 1000));
      pdfUrl = win.location.href;
    } catch (e) {
      pdfUrl = `nedostupan: ${e?.message ?? e}`;
    }
    ok('PDF prozor ne navigira van', pdfUrl.startsWith('blob:'), pdfUrl);

    // Veličina prikaza (Postavke → Prikaz): zoom mora imati dozvolu u capabilities
    // i stvarno smanjiti CSS viewport.
    const zoom = (value) => window.__TAURI_INTERNALS__.invoke('plugin:webview|set_webview_zoom', { label: 'main', value });
    const sirina = window.innerWidth;
    await zoom(1.25);
    const uzoomirano = await cekaj(() => window.innerWidth < sirina * 0.85);
    ok('webview zoom 125 %', uzoomirano, `${sirina} → ${window.innerWidth}`);
    await zoom(1);

    await kraj();
  } catch (e) {
    await kraj(`${e?.message ?? e}\n${e?.stack ?? ''}`);
  }
})();
