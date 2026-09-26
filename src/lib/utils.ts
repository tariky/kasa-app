import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ocistiPorukuIpc } from "../ipc/api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatKM(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' KM';
}

/** Količina za prikaz i polje unosa: zarez, najviše 3 decimale, bez suvišnih nula. */
export function formatKolicina(n: number): string {
  return String(Math.round(n * 1000) / 1000).replace('.', ',');
}

/** Oblik riječi po broju: mnozina(1, ['red', 'reda', 'redova']) → 'red'; 3 → 'reda'; 5, 12 → 'redova'. */
export function mnozina(n: number, [jedan, dva, pet]: [string, string, string]): string {
  const d = n % 10;
  const s = n % 100;
  if (d === 1 && s !== 11) return jedan;
  if (d >= 2 && d <= 4 && (s < 12 || s > 14)) return dva;
  return pet;
}

/**
 * Parsira decimalni unos koji može koristiti i zarez i tačku kao separator
 * ("12,50" i "12.50" → 12.5). Vraća NaN za neispravan unos, kao parseFloat.
 */
export function parseDecimal(value: string | number): number {
  if (typeof value === 'number') return value;
  return parseFloat(value.trim().replace(',', '.'));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDate(date: string): string {
  const d = new Date(date);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function formatDateTime(date: string): string {
  const d = new Date(date);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} u ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Poruka greške za prikaz; Electron IPC omot skida isto kao preload (`ocistiPorukuIpc`). */
export function porukaGreske(err: any): string {
  return ocistiPorukuIpc(String(err?.message || err || 'Nepoznata greška'));
}
