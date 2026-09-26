// Šta BackupTraka prikazuje za događaj backup:stanje ili stanje pri pokretanju.
// Čisto, da bi se tekstovi i vremena testirali bez Reacta.
import { trajnaGreska, ukupniProcenat, type BackupDogadjaj, type BackupInfo } from './backupRaspored';

export interface PrikazTrake {
  /** Širina linije 0–100 %; 0 = linija se ne crta. */
  sirina: number;
  ton: 'rad' | 'uspjeh' | 'greska';
  tekst: string;
  /** Pilula vodi u Postavke (trajna greška). */
  uPostavke: boolean;
  /** Za koliko ms traka nestaje; undefined = ostaje. */
  nestajeZaMs?: number;
}

const dvije = (n: number) => String(n).padStart(2, '0');

/** Lokalno vrijeme `HH:MM`. */
export function vrijemeHHMM(iso: string): string {
  const d = new Date(iso);
  return `${dvije(d.getHours())}:${dvije(d.getMinutes())}`;
}

const TRAJNA: PrikazTrake = { sirina: 0, ton: 'greska', tekst: 'Nema backup-a duže od 24 h', uPostavke: true };

export function prikazIzDogadjaja(d: BackupDogadjaj): PrikazTrake {
  if ('faza' in d) {
    const p = ukupniProcenat(d.faza, d.procenat);
    return { sirina: p, ton: 'rad', tekst: `Backup… ${p}%`, uPostavke: false };
  }
  if ('gotovo' in d) {
    return { sirina: 100, ton: 'uspjeh', tekst: `Backup spremljen · ${vrijemeHHMM(d.gotovo)}`, uPostavke: false, nestajeZaMs: 3000 };
  }
  if (d.trajnaGreska) return TRAJNA;
  return { sirina: 100, ton: 'greska', tekst: 'Backup nije uspio — pokušavam ponovo za 15 min', uPostavke: false, nestajeZaMs: 5000 };
}

/** Pri pokretanju: traka samo ako backup već teče ili uspjeha nema 24 h. */
export function prikazIzInfo(i: BackupInfo, sada: Date): PrikazTrake | null {
  if (!i.aktivan) return null;
  if (i.uToku) return prikazIzDogadjaja({ faza: 'kopija', procenat: 0 });
  return trajnaGreska(i, sada) ? TRAJNA : null;
}
