import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatKM(amount: number): string {
  return amount.toFixed(2).replace('.', ',') + ' KM';
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
