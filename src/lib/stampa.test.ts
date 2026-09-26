import { test, expect, describe, beforeEach, afterEach, jest } from 'bun:test';
import { createElement } from 'react';
import { Document, Page, Text } from '@react-pdf/renderer';
import { otvoriPdf, spremiPdf, PROVJERA_ZATVARANJA_MS } from './stampa';

const g = globalThis as unknown as { window: unknown };
const praviWindow = g.window;
const praviCreate = URL.createObjectURL;
const praviRevoke = URL.revokeObjectURL;

let otvoreno: Array<{ url: string; cilj: string }>;
let oslobodjeno: string[];
type Prozor = { closed: boolean; document: { title: string } };
let prozor: Prozor | null;
/** Prozor koji je test otvorio (u testovima gdje se otvara). */
const otvoren = () => prozor as Prozor;
let sacuvano: Array<{ putanja: string; bajtovi: number[] }>;
let izborPutanje: string | null;
let dijalog: unknown[];

beforeEach(() => {
  otvoreno = []; oslobodjeno = []; sacuvano = []; dijalog = [];
  prozor = { closed: false, document: { title: '' } };
  izborPutanje = '/tmp/dokument.pdf';
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = (u: string) => { oslobodjeno.push(u); };
  g.window = {
    open: (url: string, cilj: string) => { otvoreno.push({ url, cilj }); return prozor; },
    api: {
      showSaveDialog: async (d: unknown) => { dijalog.push(d); return izborPutanje; },
      writeFile: async (putanja: string, b: ArrayLike<number>) => { sacuvano.push({ putanja, bajtovi: Array.from(b) }); },
    },
  };
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  g.window = praviWindow;
  URL.createObjectURL = praviCreate;
  URL.revokeObjectURL = praviRevoke;
});

const blob = () => new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' });

describe('otvoriPdf', () => {
  test('otvara blob u novom prozoru i daje mu naslov', async () => {
    await otvoriPdf(blob(), 'Promet 01.09.2026 - 26.09.2026');
    expect(otvoreno).toEqual([{ url: 'blob:test/1', cilj: '_blank' }]);
    expect(otvoren().document.title).toBe('Promet 01.09.2026 - 26.09.2026');
  });

  test('URL živi dok je prozor otvoren (štampa i snimanje iz prozora ga još čitaju)', async () => {
    await otvoriPdf(blob());
    jest.advanceTimersByTime(PROVJERA_ZATVARANJA_MS * 50);
    expect(oslobodjeno).toEqual([]);
  });

  test('URL se oslobađa kad se prozor zatvori, i to samo jednom', async () => {
    await otvoriPdf(blob());
    otvoren().closed = true;
    jest.advanceTimersByTime(PROVJERA_ZATVARANJA_MS * 5);
    expect(oslobodjeno).toEqual(['blob:test/1']);
  });

  test('prozor koji se nije otvorio: URL se oslobađa odmah', async () => {
    prozor = null;
    await otvoriPdf(blob(), 'naslov');
    expect(oslobodjeno).toEqual(['blob:test/1']);
  });

  test('bez naslova ne dira naslov prozora', async () => {
    await otvoriPdf(blob());
    expect(otvoren().document.title).toBe('');
  });

  test('prima i React element dokumenta — pravi PDF iz njega', async () => {
    const napravljeni: Blob[] = [];
    URL.createObjectURL = (b: Blob) => { napravljeni.push(b); return 'blob:test/el'; };
    jest.useRealTimers();
    await otvoriPdf(createElement(Document, null, createElement(Page, null, createElement(Text, null, 'Test'))));
    expect(otvoreno[0].url).toBe('blob:test/el');
    const bajtovi = new Uint8Array(await napravljeni[0].arrayBuffer());
    expect(new TextDecoder().decode(bajtovi.slice(0, 5))).toBe('%PDF-');
    otvoren().closed = true;
  });
});

describe('spremiPdf', () => {
  test('pita gdje snimiti PDF i upisuje bajtove', async () => {
    expect(await spremiPdf(blob(), 'Ponuda-12-2026.pdf')).toBe(true);
    expect(dijalog).toEqual([{ defaultName: 'Ponuda-12-2026.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] }]);
    expect(sacuvano).toEqual([{ putanja: '/tmp/dokument.pdf', bajtovi: [37, 80, 68, 70] }]);
  });

  test('odustajanje od dijaloga ne upisuje ništa', async () => {
    izborPutanje = null;
    expect(await spremiPdf(blob(), 'x.pdf')).toBe(false);
    expect(sacuvano).toEqual([]);
  });
});
