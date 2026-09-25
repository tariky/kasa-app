import { test, expect } from 'bun:test';
import { imeZaCuvanje, dozvoljeniFilteri, dozvoljenaEkstenzija } from './cuvanje';

// Isti slučajevi kao Rust testovi ljuske (src-tauri/src/lib.rs, ime_za_cuvanje*).

test('predloženo ime: separatori i ":" postaju crtice, ostaje samo ime u folderu dijaloga', () => {
  expect(imeZaCuvanje('Racun-1.pdf')).toBe('Racun-1.pdf');
  expect(imeZaCuvanje('Faktura 12/2026.pdf')).toBe('Faktura 12-2026.pdf');
  expect(imeZaCuvanje('/Users/x/Library/LaunchAgents/evil.pdf')).toBe('-Users-x-Library-LaunchAgents-evil.pdf');
  expect(imeZaCuvanje('..\\..\\Startup\\izvoz.zip')).toBeNull();
  expect(imeZaCuvanje('a/../../izvoz.zip')).toBe('a-..-..-izvoz.zip');
  expect(imeZaCuvanje('C:\\Windows\\kasa-backup-2026-09-25.db')).toBe('C--Windows-kasa-backup-2026-09-25.db');
  expect(imeZaCuvanje('C:izvoz.zip')).toBe('C-izvoz.zip');
  expect(imeZaCuvanje('Izvjestaj.XLSX')).toBe('Izvjestaj.XLSX');
  expect(imeZaCuvanje(' promet.csv ')).toBe('promet.csv');
});

test('predloženo ime s nedozvoljenom ekstenzijom (ili bez nje) se odbija', () => {
  for (const los of ['evil.exe', 'skripta.sh', 'x.pdf.bat', '.bashrc', '.skriveno.pdf', 'bez-ekstenzije', '', 'folder/', '..', 'a\0.pdf', 'plist.plist', 'tacka.']) {
    expect(imeZaCuvanje(los)).toBeNull();
  }
  for (const nijeTekst of [null, undefined, 42, { ime: 'a.pdf' }]) expect(imeZaCuvanje(nijeTekst)).toBeNull();
});

test('filteri bez nedozvoljenih ekstenzija', () => {
  expect(dozvoljeniFilteri([
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'Sve', extensions: ['exe', 'zip'] },
    { name: 'Skripte', extensions: ['sh'] },
    { name: 'Excel', extensions: ['XLSX', 7] },
    { extensions: ['csv'] },
  ])).toEqual([
    { name: 'PDF', extensions: ['pdf'] },
    { name: 'Sve', extensions: ['zip'] },
    { name: 'Excel', extensions: ['XLSX'] },
    { name: '', extensions: ['csv'] },
  ]);
  expect(dozvoljeniFilteri(undefined)).toEqual([]);
  expect(dozvoljeniFilteri('pdf')).toEqual([]);
});

test('odabrana putanja: ekstenzija s liste, bez obzira na velika slova', () => {
  expect(dozvoljenaEkstenzija('/tmp/racun.pdf')).toBe(true);
  expect(dozvoljenaEkstenzija('/tmp/Backup.DB')).toBe(true);
  expect(dozvoljenaEkstenzija('/tmp/x.pdf.exe')).toBe(false);
  expect(dozvoljenaEkstenzija('/tmp/.zip')).toBe(false);
  expect(dozvoljenaEkstenzija('/tmp/bez')).toBe(false);
  expect(dozvoljenaEkstenzija(42)).toBe(false);
});
