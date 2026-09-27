import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Key, mod } from '@/components/ui/ledger';

/** Šta korisnik traži dok forma ima nespremljene izmjene: zatvaranje ili skok na susjedni dokument. */
export type ZahtjevCuvara = { kind: 'close' } | { kind: 'nav'; id: number };

export interface OpcijeCuvara {
  onClose: () => void;
  onNavigate?: (id: number) => void;
  /** Dugme „Spremi“ (i ⌘↵) u dijalogu: spremi pa nastavi; false = spremanje nije prošlo, ostaje se. */
  onSpremi?: () => Promise<boolean>;
  naslov: string;
  opis: string;
  /** Natpisi dugmadi (zadano „Odbaci izmjene“ / „Ostani“). */
  odbaci?: string;
  ostani?: string;
}

/**
 * Čuvar nespremljenih izmjena: `zatrazi` (bez argumenta: zatvaranje) zatvara ili
 * ide na susjedni dokument odmah, a s izmjenama prvo pita. `dijalog` se renderuje
 * uz formu, `otvoren` gasi prečice forme dok pitanje stoji, `ponisti` ga spušta
 * bez odluke. Fokus u pitanju je na prvom dugmetu (odbaci), kao i do sada.
 */
export function useCuvarIzmjena(dirty: boolean, o: OpcijeCuvara) {
  const [ceka, setCeka] = useState<ZahtjevCuvara | null>(null);

  const izvrsi = (z: ZahtjevCuvara) => { if (z.kind === 'close') o.onClose(); else o.onNavigate?.(z.id); };
  const zatrazi = (z: ZahtjevCuvara = { kind: 'close' }) => {
    if (dirty) { setCeka(z); return; }
    izvrsi(z);
  };
  const odbaci = () => {
    const z = ceka; setCeka(null);
    if (z) izvrsi(z);
  };
  const spremiPaNastavi = async () => { if (await o.onSpremi?.()) odbaci(); };
  const ponisti = useCallback(() => setCeka(null), []);
  const ostani = () => setCeka(null);

  const dugmeOdbaci = (
    <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={odbaci}>{o.odbaci ?? 'Odbaci izmjene'}</Button>
  );
  const dugmeOstani = <Button variant="ghost" onClick={ostani}>{o.ostani ?? 'Ostani'}</Button>;

  const dijalog = (
    <Dialog open={ceka != null} onOpenChange={v => { if (!v) setCeka(null); }}>
      <DialogContent className="sm:max-w-[420px]"
        onKeyDown={o.onSpremi ? e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); spremiPaNastavi(); } } : undefined}>
        <DialogHeader>
          <DialogTitle>{o.naslov}</DialogTitle>
          <DialogDescription>{o.opis}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-between items-center gap-2 pt-2">
          {dugmeOdbaci}
          {o.onSpremi ? (
            <div className="flex gap-2">
              {dugmeOstani}
              <Button onClick={() => spremiPaNastavi()}>Spremi <Key tone="dark">{mod('↵')}</Key></Button>
            </div>
          ) : dugmeOstani}
        </div>
      </DialogContent>
    </Dialog>
  );

  return { zatrazi, otvoren: ceka != null, ponisti, dijalog };
}
