/**
 * Renderer: dijalog nezavršenih računa (PendingRacuniDialog) se inače učita
 * samo pri pokretanju. Kad štampa završi s nepoznatim ishodom (`ishodNepoznat`
 * u odgovoru finalize poziva), ekran ga otvara odmah — operater provjerava
 * papir umjesto da ponovo šalje isti račun.
 */
const DOGADJAJ = 'pazar:nezavrseni-racuni';

export function otvoriNezavrseneRacune(): void {
  window.dispatchEvent(new Event(DOGADJAJ));
}

/** Pretplata dijaloga; vraća odjavu (za useEffect cleanup). */
export function naOtvaranjeNezavrsenih(fn: () => void): () => void {
  window.addEventListener(DOGADJAJ, fn);
  return () => window.removeEventListener(DOGADJAJ, fn);
}
