import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDokumentPostavke } from '@/components/DokumentPostavkeProvider';
import {
  LIMITI, NACINI_PLACANJA, ZADANE_DOKUMENT_POSTAVKE, procitajDokumentPostavke, uKljuceve,
  type DokumentPostavke, type NacinPlacanja,
} from '@/lib/dokumentPostavke';
import { formatBrojPonude } from '@/lib/ponuda';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { ucitajDokumentPostavke } from '@/lib/stampa';
import { cn, porukaGreske } from '@/lib/utils';
import { Save } from 'lucide-react';
import { GrupaZaglavlje, IshodPoruka, POLJE, Polje, PrekidacRed, Sekcija, SekcijaTijelo, type Ishod } from './dijelovi';
import { Numeracija, jePreskocen } from './dokumenti/Numeracija';
import { PotpisPecat } from './dokumenti/PotpisPecat';

const TEKST = 'w-full resize-none rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 '
  + 'placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

type Broj = { broj: number; godina: number };

/** Upisani broj dana: prazno → null, inače cijeli broj najviše 365. */
const dana = (v: string): number | null => {
  const cifre = v.replace(/\D/g, '');
  return cifre === '' ? null : Math.min(365, Number(cifre));
};

function NacinSelect({ id, value, onChange }: { id: string; value: NacinPlacanja; onChange: (v: NacinPlacanja) => void }) {
  return (
    <Select value={value} onValueChange={v => onChange(v as NacinPlacanja)}>
      <SelectTrigger id={id} className={POLJE}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NACINI_PLACANJA.map(n => <SelectItem key={n} value={n} className="text-[13px]">{n}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export default function DokumentiGrupa({ onIzmijenjeno }: { onIzmijenjeno: (izmijenjeno: boolean) => void }) {
  const { osvjezi } = useDokumentPostavke();
  const [forma, setForma] = useState<DokumentPostavke>(ZADANE_DOKUMENT_POSTAVKE);
  const [spremljeno, setSpremljeno] = useState<DokumentPostavke>(ZADANE_DOKUMENT_POSTAVKE);
  const [sljedeci, setSljedeci] = useState<{ ponuda: Broj | null; nalog: Broj | null }>({ ponuda: null, nalog: null });
  const [ucitano, setUcitano] = useState(false);
  const [spremam, setSpremam] = useState(false);
  const [ishod, setIshod] = useState<Ishod>(null);

  // Kanal baci grešku kad je modul Ponude/Proizvodnja isključen — tada se red „Sljedeća…“ ne prikazuje.
  const ucitajSljedece = () => Promise.all([
    window.api.getNextBrojPonude().catch(() => null),
    window.api.getNextBrojNaloga().catch(() => null),
  ]).then(([ponuda, nalog]) => setSljedeci({ ponuda, nalog }));

  useEffect(() => {
    ucitajDokumentPostavke().then((p) => {
      setForma(p);
      setSpremljeno(p);
      setUcitano(true);
    });
    ucitajSljedece();
  }, []);

  useEffect(() => {
    if (!ishod?.ok) return;
    const t = setTimeout(() => setIshod(null), 4000);
    return () => clearTimeout(t);
  }, [ishod]);

  const izmijenjeno = useMemo(() => JSON.stringify(forma) !== JSON.stringify(spremljeno), [forma, spremljeno]);
  useEffect(() => { onIzmijenjeno(izmijenjeno); }, [izmijenjeno]);

  const izmijeni = (fn: (p: DokumentPostavke) => DokumentPostavke) => {
    setForma(fn);
    setIshod(null);
  };
  const dio = <K extends 'faktura' | 'ponuda' | 'nalog' | 'kolone'>(k: K, v: Partial<DokumentPostavke[K]>) =>
    izmijeni(f => ({ ...f, [k]: { ...f[k], ...v } }));

  const spremi = async () => {
    setSpremam(true);
    try {
      // Kroz čitanje i nazad: trim, limiti, prazna važnost → 8, prazan naziv potpisa → zadani.
      const svjeze = procitajDokumentPostavke(uKljuceve(forma));
      const bilo = uKljuceve(spremljeno);
      // Samo izmijenjeni ključevi — audit bilježi svaki set, pa i base64 pečata.
      const izmjene = Object.entries(uKljuceve(svjeze)).filter(([k, v]) => v !== bilo[k]);
      await Promise.all(izmjene.map(([k, v]) => window.api.setSetting(k, v)));
      setForma(svjeze);
      setSpremljeno(svjeze);
      await Promise.all([osvjezi(), ucitajSljedece()]);
      setIshod({ ok: true, tekst: 'Postavke dokumenata su spremljene.' });
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) });
    }
    setSpremam(false);
  };

  return (
    <div className="pb-2">
      <GrupaZaglavlje naslov="Dokumenti" opis="Rokovi, tekstovi, potpisi i izgled faktura, ponuda, otpremnica, računa i radnih naloga." />

      <div className="space-y-4">
        <Sekcija naslov="Faktura" opis="Zadane vrijednosti nove fakture; kupac iz šifarnika može imati svoje.">
          <SekcijaTijelo className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Polje label="Rok plaćanja (dana)" htmlFor="dok-faktura-rok" napomena="Prazno — faktura bez roka plaćanja.">
              <Input id="dok-faktura-rok" value={forma.faktura.rokDana ?? ''} inputMode="numeric" maxLength={3}
                onChange={e => dio('faktura', { rokDana: dana(e.target.value) })}
                placeholder="Bez roka" className={cn(POLJE, 'font-mono tabular-nums')} />
            </Polje>
            <Polje label="Način plaćanja" htmlFor="dok-faktura-nacin">
              <NacinSelect id="dok-faktura-nacin" value={forma.faktura.nacinPlacanja} onChange={v => dio('faktura', { nacinPlacanja: v })} />
            </Polje>
            <Polje label="Napomena na fakturi" htmlFor="dok-faktura-napomena" className="col-span-2"
              napomena="Upisuje se u svaku novu fakturu; može se promijeniti na fakturi. Faktura iz ponude i dalje piše „Po ponudi br. …“.">
              <textarea id="dok-faktura-napomena" value={forma.faktura.napomena} rows={3} maxLength={LIMITI.napomena}
                onChange={e => dio('faktura', { napomena: e.target.value })} className={TEKST} />
            </Polje>
          </SekcijaTijelo>
        </Sekcija>

        <Sekcija naslov="Ponuda">
          <SekcijaTijelo className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Polje label="Važi (dana)" htmlFor="dok-ponuda-vazi" napomena="Od 1 do 365 dana.">
              <Input id="dok-ponuda-vazi" value={forma.ponuda.vaziDana || ''} inputMode="numeric" maxLength={3}
                onChange={e => dio('ponuda', { vaziDana: dana(e.target.value) ?? 0 })}
                placeholder={String(ZADANE_DOKUMENT_POSTAVKE.ponuda.vaziDana)} className={cn(POLJE, 'font-mono tabular-nums')} />
            </Polje>
            <Polje label="Način plaćanja pri konverziji" htmlFor="dok-ponuda-nacin" napomena="Predložen kad se ponuda pretvara u račun.">
              <NacinSelect id="dok-ponuda-nacin" value={forma.ponuda.nacinPlacanja} onChange={v => dio('ponuda', { nacinPlacanja: v })} />
            </Polje>
            <Polje label="Uslovi ponude" htmlFor="dok-ponuda-uslovi" className="col-span-2" napomena="Ispisuje se iza „Ponuda važi do …“.">
              <textarea id="dok-ponuda-uslovi" value={forma.ponuda.uslovi} rows={3} maxLength={LIMITI.uslovi}
                onChange={e => dio('ponuda', { uslovi: e.target.value })} className={TEKST} />
            </Polje>
          </SekcijaTijelo>
          <SekcijaTijelo className="border-t border-slate-100">
            <Numeracija id="dok-ponuda" saCiframa
              format={forma.ponuda.broj} onFormat={broj => dio('ponuda', { broj })}
              nastavak={forma.ponuda.nastavak} onNastavak={nastavak => dio('ponuda', { nastavak })}
              sljedeci={sljedeci.ponuda && {
                naziv: 'Sljedeća ponuda',
                tekst: formatBrojPonude(sljedeci.ponuda, forma.ponuda.broj),
                preskocen: jePreskocen(sljedeci.ponuda, spremljeno.ponuda.nastavak),
              }} />
          </SekcijaTijelo>
        </Sekcija>

        <Sekcija naslov="Radni nalog">
          <SekcijaTijelo>
            <Numeracija id="dok-nalog" saCiframa={false}
              format={forma.nalog.broj} onFormat={broj => dio('nalog', { broj })}
              nastavak={forma.nalog.nastavak} onNastavak={nastavak => dio('nalog', { nastavak })}
              sljedeci={sljedeci.nalog && {
                naziv: 'Sljedeći radni nalog',
                tekst: formatBrojNaloga(sljedeci.nalog, forma.nalog.broj),
                preskocen: jePreskocen(sljedeci.nalog, spremljeno.nalog.nastavak),
              }} />
          </SekcijaTijelo>
        </Sekcija>

        <Sekcija naslov="Izgled dokumenata" opis="Kolona Rabat se sama pojavi kad neka stavka ima rabat.">
          <PrekidacRed id="dok-kolona-sifra" naslov="Prikaži šifru artikla" checked={forma.kolone.sifra}
            opis="Na računu, ponudi i otpremnici. Faktura uvijek prikazuje šifru."
            onChange={sifra => dio('kolone', { sifra })} />
          <PrekidacRed id="dok-kolona-jm" naslov="Prikaži jedinicu mjere" checked={forma.kolone.jm}
            opis="Na svim dokumentima."
            onChange={jm => dio('kolone', { jm })} />
          <SekcijaTijelo className="border-t border-slate-100">
            <Polje label="Tekst u podnožju" htmlFor="dok-podnozje"
              napomena="Npr. upis u sudski registar. Ispisuje se na dnu svake stranice svih dokumenata. Najviše 4 reda na dokumentu.">
              <textarea id="dok-podnozje" value={forma.podnozje} rows={2} maxLength={LIMITI.podnozje}
                onChange={e => izmijeni(f => ({ ...f, podnozje: e.target.value }))} className={TEKST} />
            </Polje>
          </SekcijaTijelo>
        </Sekcija>

        <PotpisPecat forma={forma} izmijeni={izmijeni} />
      </div>

      {/* Traka za spremanje prati skrol — sve kartice se spremaju zajedno. */}
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
          <Button size="sm" onClick={spremi} disabled={!izmijenjeno || spremam || !ucitano}
            className="h-8 gap-1.5 text-[12px] bg-[#0f1629] hover:bg-[#1b2540]">
            <Save className="h-3.5 w-3.5" />
            {spremam ? 'Spremam…' : 'Spremi postavke dokumenata'}
          </Button>
        </div>
      </div>
    </div>
  );
}
