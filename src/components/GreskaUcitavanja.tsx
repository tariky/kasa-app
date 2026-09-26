import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Traka ispod alatne trake kad podaci nisu učitani — da prazna lista ne izgleda
 * kao „nema podataka“. Ništa ne crta kad greške nema.
 */
export function GreskaUcitavanja({ greska, onPonovo }: { greska: string | null; onPonovo?: () => void }) {
  if (!greska) return null;
  return (
    <div role="alert" className="flex-shrink-0 flex items-center gap-2 px-6 py-2 border-b border-rose-100 bg-rose-50/60 text-[12px] font-medium text-rose-700">
      <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="min-w-0">Podaci nisu učitani: {greska}</span>
      {onPonovo && (
        <button onClick={onPonovo} className="ml-auto flex flex-shrink-0 items-center gap-1.5 text-rose-600/80 hover:text-rose-800">
          <RefreshCw className="h-3.5 w-3.5" /> Pokušaj ponovo
        </button>
      )}
    </div>
  );
}
