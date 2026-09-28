// DIJAGNOSTIKA (privremeno): bisekcija storno testa koji na Windowsu zaglavi.
import { test, expect } from 'bun:test';
import { otvoriBackend, prijavi, ADMIN_PIN, type Backend } from '../src/ipc/ugovor/backend';
import { scenarij } from '../src/ipc/ugovor/scenarij';

let b: Backend;
const baza = scenarij(() => b);

async function rucniRacun(broj: string): Promise<number> {
  const p = baza.artikal({ sifra: `R${broj}`, cijena: 3 });
  return (await b.pozovi('order:createManual', {
    nacinPlacanja: 'Gotovina', brojFiskalnogRacuna: broj, createdAt: '2026-09-01 10:00:00',
    stavke: [{ productId: p, kolicina: 1, cijena: 3, rabat: 0, pdvStopa: 'E' }],
  })).id;
}

function korak(s: string) { console.error(`[bisekcija] ${s}`); }

async function storno(opcije: { krivi: 'rejects' | 'trycatch' | 'nema'; korisnici: 'baza' | 'kanal' }) {
  b = await otvoriBackend();
  try {
    const id = await rucniRacun('55');
    korak('racun');
    if (opcije.korisnici === 'baza') {
      baza.korisnik('Kasir', '1234');
      baza.korisnik('Berina', '1111', 'admin');
    } else {
      await b.call('user:create', { ime: 'Kasir', pin: '1234', uloga: 'kasir' });
      await b.call('user:create', { ime: 'Berina', pin: '1111', uloga: 'admin' });
    }
    korak('korisnici');
    baza.postavka('kasa.requirePinRefund', 'true');
    await prijavi(b, '1234');
    korak('prijava kasira');
    if (opcije.krivi === 'rejects') {
      await expect(b.call('order:refundAndPrint', { id, adminPin: '9999' })).rejects.toThrow('Neispravan admin PIN');
    } else if (opcije.krivi === 'trycatch') {
      let g: unknown;
      try { await b.call('order:refundAndPrint', { id, adminPin: '9999' }); } catch (e) { g = e; }
      expect(String(g)).toContain('Neispravan admin PIN');
    }
    korak('krivi PIN');
    const r = await b.pozovi('order:refundAndPrint', { id, adminPin: '1111' });
    expect(r.success).toBe(true);
    korak('storno');
  } finally {
    await b.close();
  }
}

test('original', () => storno({ krivi: 'rejects', korisnici: 'baza' }), 15000);
test('trycatch', () => storno({ krivi: 'trycatch', korisnici: 'baza' }), 15000);
test('bezkrivog', () => storno({ krivi: 'nema', korisnici: 'baza' }), 15000);
test('korisnicikanal', () => storno({ krivi: 'rejects', korisnici: 'kanal' }), 15000);

test('rejectsposporom', async () => {
  b = await otvoriBackend();
  try {
    for (let i = 0; i < 5; i++) {
      await b.call('user:login', ADMIN_PIN);
      await expect(b.call('nema:kanala')).rejects.toThrow();
      korak(`rejectsposporom ${i}`);
    }
  } finally {
    await b.close();
  }
}, 15000);

test('resolvesposporom', async () => {
  b = await otvoriBackend();
  try {
    for (let i = 0; i < 5; i++) {
      await b.call('user:login', ADMIN_PIN);
      await expect(b.call('user:login', ADMIN_PIN)).resolves.toBeTruthy();
      korak(`resolvesposporom ${i}`);
    }
  } finally {
    await b.close();
  }
}, 15000);
