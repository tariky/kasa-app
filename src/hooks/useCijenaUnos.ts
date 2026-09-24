import { useEffect, useState } from 'react';
import { brutoIzUnosa, prikazCijene, promijeniRezim, type Sidro } from '@/lib/pdvUnos';
import { useUnosBezPdv } from '@/hooks/useUnosBezPdv';

/**
 * Stanje polja za cijenu s prekidačem "sa PDV / bez PDV". Postavka
 * `cijene.unosBezPdv` bira samo početni režim — svako otvaranje dijaloga kreće
 * od nje, a operator ga može prebaciti za taj unos.
 *
 * `spremno` je `false` dok se postavka učitava; dijalog tada ne smije
 * dozvoliti spremanje, jer bi upisani broj mogao biti u pogrešnoj jedinici.
 */
export function useCijenaUnos(open: boolean, original: Sidro | null, stopa: 'E' | 'K') {
  const zadano = useUnosBezPdv(open);
  const [bezPdv, setBezPdv] = useState(false);
  const [unos, setUnos] = useState('');
  const [sidro, setSidro] = useState<Sidro | null>(null);
  const [spremno, setSpremno] = useState(false);

  useEffect(() => {
    if (!open) { setSpremno(false); return; }
    // Dok se postavka učitava ne diramo polje — inače bismo cijenu prikazali
    // u pogrešnoj jedinici pa je pregazili kad postavka stigne.
    if (zadano === null) return;
    setBezPdv(zadano);
    setSidro(original);
    setUnos(original ? prikazCijene(original.cijena, original.pdvStopa, zadano) : '');
    setSpremno(true);
  }, [open, original, zadano]);

  const bruto = brutoIzUnosa({ unos, stopa, bezPdv, sidro });

  const setRezim = (novi: boolean) => {
    if (novi === bezPdv) return;
    const r = promijeniRezim({ unos, stopa, bezPdv, sidro }, novi);
    setUnos(r.unos);
    setSidro(r.sidro);
    setBezPdv(novi);
  };

  return { unos, setUnos, bezPdv, setRezim, bruto, spremno };
}
