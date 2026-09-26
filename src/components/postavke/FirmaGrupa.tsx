import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ZaglavljePrikaz } from '@/components/ZaglavljePrikaz';
import { ZiroRacuniPozicijaBirac } from '@/components/ZiroRacuniPozicijaBirac';
import { LOGO_VELICINA, kontaktFirme } from '@/lib/firma';
import { cn, porukaGreske } from '@/lib/utils';
import type { BankAccount, FirmaSettings } from '@/types';
import { Save } from 'lucide-react';
import { GrupaZaglavlje, IshodPoruka, POLJE, Polje, Sekcija, SekcijaTijelo, type Ishod } from './dijelovi';
import { SlikaBirac, VelicinaSlike } from './SlikaBirac';

const BROJ_RACUNA = 3;

type Forma = Omit<FirmaSettings, 'bankAccounts'> & { bankAccounts: BankAccount[] };

const PRAZNA: Forma = {
  naziv: '', adresa: '', grad: '', idBroj: '', pdvBroj: '', skladiste: '', web: '', email: '',
  logo: '', logoVelicina: LOGO_VELICINA.zadano, ziroRacuniPozicija: 'zaglavlje',
  bankAccounts: Array.from({ length: BROJ_RACUNA }, () => ({ bankName: '', accountNumber: '' })),
};

/** Tri reda za račune, prazni gdje firma ima manje. */
function uFormu(s: FirmaSettings): Forma {
  return {
    ...s,
    bankAccounts: Array.from({ length: BROJ_RACUNA }, (_, i) => s.bankAccounts[i] ?? { bankName: '', accountNumber: '' }),
  };
}

export default function FirmaGrupa({ onSpremljeno, onIzmijenjeno }: {
  onSpremljeno: () => void;
  onIzmijenjeno: (izmijenjeno: boolean) => void;
}) {
  const [forma, setForma] = useState<Forma>(PRAZNA);
  const [spremljeno, setSpremljeno] = useState<Forma>(PRAZNA);
  const [ucitano, setUcitano] = useState(false);
  const [spremam, setSpremam] = useState(false);
  const [ishod, setIshod] = useState<Ishod>(null);

  useEffect(() => {
    window.api.getFirmaSettings().then((s) => {
      const f = uFormu(s);
      setForma(f);
      setSpremljeno(f);
      setUcitano(true);
    });
  }, []);

  useEffect(() => {
    if (!ishod?.ok) return;
    const t = setTimeout(() => setIshod(null), 4000);
    return () => clearTimeout(t);
  }, [ishod]);

  const izmijenjeno = useMemo(() => JSON.stringify(forma) !== JSON.stringify(spremljeno), [forma, spremljeno]);
  useEffect(() => { onIzmijenjeno(izmijenjeno); }, [izmijenjeno]);

  const postavi = <K extends keyof Forma>(kljuc: K, v: Forma[K]) => {
    setForma(f => ({ ...f, [kljuc]: v }));
    setIshod(null);
  };

  const postaviRacun = (i: number, polje: keyof BankAccount, v: string) => {
    setForma(f => {
      const racuni = [...f.bankAccounts];
      racuni[i] = { ...racuni[i], [polje]: v };
      return { ...f, bankAccounts: racuni };
    });
    setIshod(null);
  };

  const spremi = async () => {
    setSpremam(true);
    try {
      await window.api.saveFirmaSettings({
        ...forma,
        web: forma.web.trim(),
        email: forma.email.trim(),
        bankAccounts: forma.bankAccounts
          .map(a => ({ bankName: a.bankName.trim(), accountNumber: a.accountNumber.trim() }))
          .filter(a => a.bankName !== '' || a.accountNumber !== ''),
      });
      setSpremljeno(forma);
      setIshod({ ok: true, tekst: 'Podaci firme su spremljeni.' });
      onSpremljeno();
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) });
    }
    setSpremam(false);
  };

  return (
    <div className="pb-2">
      <GrupaZaglavlje naslov="Firma" opis="Podaci koji se ispisuju na računima, fakturama, ponudama i ostalim dokumentima." />

      <div className="space-y-4">
        <Sekcija naslov="Osnovni podaci">
          <SekcijaTijelo className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Polje label="Naziv firme" htmlFor="firma-naziv" className="col-span-2">
              <Input id="firma-naziv" value={forma.naziv} onChange={e => postavi('naziv', e.target.value)}
                placeholder="Moja firma d.o.o." className={POLJE} />
            </Polje>
            <Polje label="Adresa" htmlFor="firma-adresa">
              <Input id="firma-adresa" value={forma.adresa} onChange={e => postavi('adresa', e.target.value)}
                placeholder="Ulica bb" className={POLJE} />
            </Polje>
            <Polje label="Grad" htmlFor="firma-grad">
              <Input id="firma-grad" value={forma.grad} onChange={e => postavi('grad', e.target.value)}
                placeholder="Sarajevo" className={POLJE} />
            </Polje>
            <Polje label="ID broj" htmlFor="firma-id">
              <Input id="firma-id" value={forma.idBroj} onChange={e => postavi('idBroj', e.target.value.replace(/\D/g, ''))}
                placeholder="4200000000000" maxLength={13} inputMode="numeric" className={cn(POLJE, 'font-mono tabular-nums')} />
            </Polje>
            <Polje label="PDV broj" htmlFor="firma-pdv">
              <Input id="firma-pdv" value={forma.pdvBroj} onChange={e => postavi('pdvBroj', e.target.value.replace(/\D/g, ''))}
                placeholder="200000000000" maxLength={12} inputMode="numeric" className={cn(POLJE, 'font-mono tabular-nums')} />
            </Polje>
            <Polje label="Web stranica" htmlFor="firma-web">
              <Input id="firma-web" value={forma.web} onChange={e => postavi('web', e.target.value)}
                placeholder="www.firma.ba" className={POLJE} />
            </Polje>
            <Polje label="Email" htmlFor="firma-email">
              <Input id="firma-email" type="email" value={forma.email} onChange={e => postavi('email', e.target.value)}
                placeholder="info@firma.ba" className={POLJE} />
            </Polje>
            <Polje label="Naziv skladišta" htmlFor="firma-skladiste" napomena="Ispisuje se na ulazu robe, nivelacijama i otpremnicama.">
              <Input id="firma-skladiste" value={forma.skladiste} onChange={e => postavi('skladiste', e.target.value)}
                placeholder="Glavno skladište" className={POLJE} />
            </Polje>
          </SekcijaTijelo>
        </Sekcija>

        <Sekcija naslov="Logo i zaglavlje" opis="Primjenjuje se na račune, fakture, ponude, otpremnice i radne naloge.">
          <SekcijaTijelo className="space-y-5">
            <SlikaBirac slika={forma.logo} onChange={v => postavi('logo', v)} alt="Logo firme"
              dodajTekst="Dodaj logo" zamijeniTekst="Zamijeni logo"
              napomena="PNG, JPG ili SVG, najbolje kvadratni oko 200 × 200 px." />

            <VelicinaSlike naslov="Veličina loga" vrijednost={forma.logoVelicina} onChange={v => postavi('logoVelicina', v)}
              min={LOGO_VELICINA.min} max={LOGO_VELICINA.max} zadano={LOGO_VELICINA.zadano} />

            <ZaglavljePrikaz
              naziv={forma.naziv}
              adresa={forma.adresa}
              grad={forma.grad}
              kontakt={kontaktFirme({ web: forma.web, email: forma.email })}
              logo={forma.logo}
              logoVelicina={forma.logoVelicina}
            />
          </SekcijaTijelo>
        </Sekcija>

        <Sekcija naslov="Bankovni računi" opis="Do tri računa; prazni redovi se ne ispisuju.">
          <SekcijaTijelo className="space-y-3">
            <div className="grid grid-cols-[20px_1fr_1fr] items-center gap-x-3 gap-y-2">
              <span />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Banka</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Broj računa</span>
              {forma.bankAccounts.map((acc, i) => (
                <div key={i} className="contents">
                  <span className="font-mono text-[11px] tabular-nums text-slate-300 text-right">{i + 1}</span>
                  <Input value={acc.bankName} onChange={e => postaviRacun(i, 'bankName', e.target.value)}
                    aria-label={`Banka, račun ${i + 1}`} placeholder="Naziv banke" className={POLJE} />
                  <Input value={acc.accountNumber} onChange={e => postaviRacun(i, 'accountNumber', e.target.value)}
                    aria-label={`Broj računa ${i + 1}`} placeholder="1234567890123456" className={cn(POLJE, 'font-mono tabular-nums')} />
                </div>
              ))}
            </div>
            <div className="pt-2 space-y-2">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Položaj na fakturi</span>
              <ZiroRacuniPozicijaBirac value={forma.ziroRacuniPozicija} onChange={v => postavi('ziroRacuniPozicija', v)} />
            </div>
          </SekcijaTijelo>
        </Sekcija>
      </div>

      {/* Traka za spremanje prati skrol — sve tri kartice se spremaju zajedno. */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-4 pb-5 pt-3 px-1 bg-gradient-to-t from-[hsl(220,20%,97%)] from-70% to-transparent">
        <div className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-2.5 transition-colors',
          izmijenjeno ? 'border-slate-300 bg-white shadow-md shadow-slate-300/30' : 'border-slate-200/70 bg-white/80',
        )}>
          {ishod
            ? <IshodPoruka ishod={ishod} className="flex-1" />
            : (
              <p className="flex-1 text-[12px] text-slate-500">
                {!ucitano ? 'Učitavanje…' : izmijenjeno ? 'Imate nespremljene izmjene.' : 'Sve izmjene su spremljene.'}
              </p>
            )}
          {izmijenjeno && (
            <Button variant="ghost" size="sm" onClick={() => { setForma(spremljeno); setIshod(null); }}
              className="h-8 text-[12px] text-slate-500">
              Odbaci
            </Button>
          )}
          <Button size="sm" onClick={spremi} disabled={!izmijenjeno || spremam}
            className="h-8 gap-1.5 text-[12px] bg-[#0f1629] hover:bg-[#1b2540]">
            <Save className="h-3.5 w-3.5" />
            {spremam ? 'Spremam…' : 'Spremi podatke firme'}
          </Button>
        </div>
      </div>
    </div>
  );
}
