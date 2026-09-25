import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { APP_URL, CSP_ELECTRON, imaDebugPrekidac, jeDozvoljenaNavigacija, jeDozvoljenaNavigacijaPopupa, jeDozvoljenPopup, meniSablon, putanjaZaZahtjev } from './sigurnost';

describe('jeDozvoljenaNavigacija', () => {
  test('upakovana aplikacija: samo app://pazar', () => {
    expect(jeDozvoljenaNavigacija('app://pazar/index.html', APP_URL)).toBe(true);
    expect(jeDozvoljenaNavigacija('app://pazar/index.html#/kasa', APP_URL)).toBe(true);
    expect(jeDozvoljenaNavigacija('app://drugi/index.html', APP_URL)).toBe(false);
    expect(jeDozvoljenaNavigacija('https://evil.example/', APP_URL)).toBe(false);
    expect(jeDozvoljenaNavigacija('file:///etc/passwd', APP_URL)).toBe(false);
    expect(jeDozvoljenaNavigacija('javascript:alert(1)', APP_URL)).toBe(false);
    expect(jeDozvoljenaNavigacija('blob:app://pazar/abc', APP_URL)).toBe(false);
    expect(jeDozvoljenaNavigacija('nije url', APP_URL)).toBe(false);
  });

  test('razvoj: isti Vite server (šema, host i port)', () => {
    const dev = 'http://localhost:5173';
    expect(jeDozvoljenaNavigacija('http://localhost:5173/', dev)).toBe(true);
    expect(jeDozvoljenaNavigacija('http://localhost:5174/', dev)).toBe(false);
    expect(jeDozvoljenaNavigacija('https://localhost:5173/', dev)).toBe(false);
    expect(jeDozvoljenaNavigacija('http://localhost.evil.example:5173/', dev)).toBe(false);
  });
});

describe('jeDozvoljenPopup', () => {
  test('samo blob: (PDF pregled)', () => {
    expect(jeDozvoljenPopup('blob:app://pazar/6f1c')).toBe(true);
    expect(jeDozvoljenPopup('https://lunatik.ba')).toBe(false);
    expect(jeDozvoljenPopup('app://pazar/index.html')).toBe(false);
    expect(jeDozvoljenPopup('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(jeDozvoljenPopup('javascript:blob:')).toBe(false);
  });
});

describe('jeDozvoljenaNavigacijaPopupa', () => {
  test('samo prvo učitavanje blob: iz about:blank', () => {
    expect(jeDozvoljenaNavigacijaPopupa('blob:app://pazar/6f1c', 'about:blank')).toBe(true);
    expect(jeDozvoljenaNavigacijaPopupa('blob:app://pazar/6f1c', '')).toBe(true);
    expect(jeDozvoljenaNavigacijaPopupa('blob:app://pazar/drugi', 'blob:app://pazar/6f1c')).toBe(false);
    expect(jeDozvoljenaNavigacijaPopupa('https://evil.example/', 'about:blank')).toBe(false);
    expect(jeDozvoljenaNavigacijaPopupa('app://pazar/index.html', 'about:blank')).toBe(false);
    expect(jeDozvoljenaNavigacijaPopupa('https://evil.example/', 'blob:app://pazar/6f1c')).toBe(false);
  });
});

describe('putanjaZaZahtjev', () => {
  const korijen = path.resolve('/app/renderer/main_window');

  test('fajlovi renderera', () => {
    expect(putanjaZaZahtjev('app://pazar/index.html', korijen)).toBe(path.join(korijen, 'index.html'));
    expect(putanjaZaZahtjev('app://pazar/', korijen)).toBe(path.join(korijen, 'index.html'));
    expect(putanjaZaZahtjev('app://pazar/assets/index-abc.js?v=1', korijen)).toBe(path.join(korijen, 'assets', 'index-abc.js'));
    expect(putanjaZaZahtjev('app://pazar/assets/DM%20Sans.woff2', korijen)).toBe(path.join(korijen, 'assets', 'DM Sans.woff2'));
  });

  test('ništa izvan foldera renderera ni tuđeg hosta', () => {
    // URL parser sam svede /../ i /%2e%2e/ na korijen — ostaje unutar foldera.
    expect(putanjaZaZahtjev('app://pazar/../../main.js', korijen)).toBe(path.join(korijen, 'main.js'));
    expect(putanjaZaZahtjev('app://pazar/%2e%2e/%2e%2e/main.js', korijen)).toBe(path.join(korijen, 'main.js'));
    expect(putanjaZaZahtjev('app://pazar/assets/%2e%2e%2f%2e%2e%2fmain.js', korijen)).toBeNull();
    expect(putanjaZaZahtjev('app://pazar/a%00.js', korijen)).toBeNull();
    expect(putanjaZaZahtjev('app://pazar/%E0%A4%A', korijen)).toBeNull();
    expect(putanjaZaZahtjev('app://drugi/index.html', korijen)).toBeNull();
    expect(putanjaZaZahtjev('file:///app/renderer/main_window/index.html', korijen)).toBeNull();
  });

  test('Windows: obrnute kose crte i slova diska ne izlaze iz foldera', () => {
    const w = path.win32;
    const k = 'C:\\Program Files\\Pazar\\resources\\app.asar\\.vite\\renderer\\main_window';
    expect(putanjaZaZahtjev('app://pazar/assets/a.js', k, w)).toBe(`${k}\\assets\\a.js`);
    expect(putanjaZaZahtjev('app://pazar/..%5C..%5C..%5Ckasa.db', k, w)).toBeNull();
    expect(putanjaZaZahtjev('app://pazar/C:/Windows/win.ini', k, w)).toBeNull();
    expect(putanjaZaZahtjev('app://pazar/%5C%5Cserver%5Cshare%5Cx', k, w)).toBe(`${k}\\server\\share\\x`);
  });
});

describe('CSP_ELECTRON', () => {
  const direktive = new Map(CSP_ELECTRON.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));

  test('bez inline/eval skripti i vanjskih domena', () => {
    expect(direktive.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(direktive.get('default-src')).toEqual(["'self'"]);
    expect(direktive.get('object-src')).toEqual(["'none'"]);
    expect(direktive.get('base-uri')).toEqual(["'none'"]);
    expect(direktive.get('form-action')).toEqual(["'none'"]);
    expect(CSP_ELECTRON).not.toContain('http');
    expect(CSP_ELECTRON).not.toContain("'unsafe-eval'");
  });
});

describe('meniSablon', () => {
  const uloge = (m: ReturnType<typeof meniSablon>) => m.map(s => s.role ?? s.label);
  const pogled = (m: ReturnType<typeof meniSablon>) => {
    const p = m.find(s => s.label === 'View');
    return (p?.submenu as Array<{ role?: string; type?: string }>).map(s => s.role ?? s.type);
  };
  const zoom = ['resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'];

  for (const mac of [true, false]) {
    test(`paket (${mac ? 'macOS' : 'Windows/Linux'}): Pogled samo zoom i puni ekran, Uredi ostaje`, () => {
      const m = meniSablon({ mac, razvoj: false });
      expect(uloge(m)).toEqual([...(mac ? ['appMenu'] : []), 'fileMenu', 'editMenu', 'View', 'windowMenu']);
      expect(pogled(m)).toEqual(zoom);
    });

    test(`razvoj (${mac ? 'macOS' : 'Windows/Linux'}): Pogled i Reload/DevTools`, () => {
      const m = meniSablon({ mac, razvoj: true });
      expect(uloge(m)).toEqual([...(mac ? ['appMenu'] : []), 'fileMenu', 'editMenu', 'View', 'windowMenu']);
      expect(pogled(m)).toEqual(['reload', 'forceReload', 'toggleDevTools', 'separator', ...zoom]);
    });
  }
});

describe('imaDebugPrekidac', () => {
  test('prepoznaje --remote-debugging-port/pipe u svim oblicima', () => {
    for (const arg of [
      '--remote-debugging-port=9222',
      '--remote-debugging-port',
      '--remote-debugging-pipe',
      '-remote-debugging-port=0',
      '/remote-debugging-port=9222',
      '--REMOTE-DEBUGGING-PORT=9222',
      ' --remote-debugging-pipe ',
    ]) {
      expect(imaDebugPrekidac(['C:\\Pazar\\Pazar.exe', arg])).toBe(true);
    }
  });

  test('običan start i slični prekidači ne smetaju', () => {
    expect(imaDebugPrekidac(['/Applications/Pazar.app/Contents/MacOS/Pazar'])).toBe(false);
    expect(imaDebugPrekidac(['Pazar.exe', '--squirrel-firstrun', '--user-data-dir=C:\\x'])).toBe(false);
    expect(imaDebugPrekidac(['Pazar.exe', '--remote-debugging-portx=1', 'remote-debugging-port=1'])).toBe(false);
    expect(imaDebugPrekidac(['Pazar.exe', '--remote-debugging-address=0.0.0.0'])).toBe(false);
  });
});
