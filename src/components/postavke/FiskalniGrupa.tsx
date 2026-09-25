import { Fragment, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, porukaGreske } from '@/lib/utils';
import type { TringSettings } from '@/types';
import { ChevronDown, Loader2, RefreshCw, Save, Trash2, Wifi } from 'lucide-react';
import {
  GrupaZaglavlje, IshodPoruka, POLJE, Polje, PrekidacRed, Sekcija, SekcijaPodnozje, SekcijaTijelo, type Ishod,
} from './dijelovi';

type Numeracija = { zadnjiUBazi: number | null; zadnjiUpisani: number | null; predvidjeni: number | null };

export default function FiskalniGrupa({ onSpremljeno }: { onSpremljeno: () => void }) {
  return (
    <div className="pb-6">
      <GrupaZaglavlje naslov="Fiskalni uređaj" opis="Veza s Tring.Fiscal.Serverom i sve što se štampa na fiskalnom računu." />
      <div className="space-y-4">
        <Konekcija onSpremljeno={onSpremljeno} />
        <NapomenaRacuna />
        <PosljednjiBroj />
        <Dijagnostika />
      </div>
    </div>
  );
}

function Konekcija({ onSpremljeno }: { onSpremljeno: () => void }) {
  const [host, setHost] = useState('localhost');
  // Port i operator ID se drže kao tekst da prazno polje ne postane 0.
  const [port, setPort] = useState('8085');
  const [operatorId, setOperatorId] = useState('0');
  const [lozinka, setLozinka] = useState('0');
  const [ishod, setIshod] = useState<Ishod>(null);
  const [testiram, setTestiram] = useState(false);

  useEffect(() => {
    window.api.getTringSettings().then((s: TringSettings) => {
      if (!s) return;
      setHost(s.host || 'localhost');
      setPort(String(s.port ?? 8085));
      setOperatorId(String(s.operatorId ?? 0));
      setLozinka(s.operatorPassword || '0');
    }).catch(() => { /* ostaju zadane vrijednosti */ });
  }, []);

  const spremi = async () => {
    const p = parseInt(port, 10);
    const op = parseInt(operatorId, 10);
    if (!host.trim()) return setIshod({ ok: false, tekst: 'Upišite host.' });
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setIshod({ ok: false, tekst: 'Port mora biti broj između 1 i 65535.' });
    if (!Number.isInteger(op) || op < 0) return setIshod({ ok: false, tekst: 'Operator ID mora biti 0 ili veći broj.' });
    try {
      await window.api.saveTringSettings({ host: host.trim(), port: p, operatorId: op, operatorPassword: lozinka });
      setIshod({ ok: true, tekst: 'Postavke veze su spremljene.' });
      onSpremljeno();
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) || 'Postavke veze nisu spremljene.' });
    }
  };

  const testiraj = async () => {
    setIshod(null);
    setTestiram(true);
    try {
      const r = await window.api.tringInit();
      if (r?.success) {
        setIshod({ ok: true, tekst: `Uređaj se javio (${r.vrstaOdgovora}).` });
      } else {
        const detalji = r?.odgovori ? Object.entries(r.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setIshod({ ok: false, tekst: `Uređaj se ne javlja: ${r?.error || r?.vrstaOdgovora || 'nepoznata greška'}${detalji ? ` (${detalji})` : ''}` });
      }
    } catch (err: any) {
      setIshod({ ok: false, tekst: `Uređaj se ne javlja: ${err?.message || 'provjerite host i port.'}` });
    }
    setTestiram(false);
  };

  return (
    <Sekcija naslov="Veza s uređajem" opis="Tring.Fiscal.Server mora biti pokrenut na ovom hostu i portu.">
      <SekcijaTijelo className="grid grid-cols-[1fr_120px] gap-x-4 gap-y-4">
        <Polje label="Host" htmlFor="tring-host">
          <Input id="tring-host" value={host} onChange={e => setHost(e.target.value)} className={cn(POLJE, 'font-mono')} />
        </Polje>
        <Polje label="Port" htmlFor="tring-port">
          <Input id="tring-port" inputMode="numeric" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))}
            maxLength={5} className={cn(POLJE, 'font-mono tabular-nums')} />
        </Polje>
        <Polje label="Operator ID" htmlFor="tring-operator">
          <Input id="tring-operator" inputMode="numeric" value={operatorId} onChange={e => setOperatorId(e.target.value.replace(/\D/g, ''))}
            className={cn(POLJE, 'font-mono tabular-nums')} />
        </Polje>
        <Polje label="Lozinka" htmlFor="tring-password">
          <Input id="tring-password" value={lozinka} onChange={e => setLozinka(e.target.value)} className={cn(POLJE, 'font-mono')} />
        </Polje>
      </SekcijaTijelo>
      <SekcijaPodnozje>
        <Button size="sm" onClick={spremi} className="h-8 gap-1.5 text-[12px] bg-[#0f1629] hover:bg-[#1b2540]">
          <Save className="h-3.5 w-3.5" />
          Spremi
        </Button>
        <Button variant="outline" size="sm" onClick={testiraj} disabled={testiram} className="h-8 gap-1.5 text-[12px] border-slate-200">
          {testiram ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
          Testiraj vezu
        </Button>
        <IshodPoruka ishod={ishod} className="ml-2 flex-1 min-w-[200px]" />
      </SekcijaPodnozje>
    </Sekcija>
  );
}

function NapomenaRacuna() {
  const [napomena, setNapomena] = useState('');
  const [spremljena, setSpremljena] = useState('');
  const [ishod, setIshod] = useState<Ishod>(null);

  useEffect(() => {
    window.api.getSetting('racun.napomena').then((v) => { setNapomena(v || ''); setSpremljena(v || ''); });
  }, []);

  const spremi = async () => {
    try {
      await window.api.setSetting('racun.napomena', napomena);
      setSpremljena(napomena);
      setIshod({ ok: true, tekst: 'Napomena je spremljena.' });
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) });
    }
  };

  return (
    <Sekcija naslov="Napomena na računu" opis="Tekst koji se štampa na dnu svakog fiskalnog računa.">
      <SekcijaTijelo>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Napomena na računu"
            value={napomena}
            onChange={e => { setNapomena(e.target.value); setIshod(null); }}
            onKeyDown={e => { if (e.key === 'Enter' && napomena !== spremljena) spremi(); }}
            placeholder="npr. Hvala na posjeti!"
            maxLength={100}
            className={cn(POLJE, 'flex-1')}
          />
          <Button size="sm" variant="outline" onClick={spremi} disabled={napomena === spremljena}
            className="h-9 gap-1.5 text-[12px] border-slate-200">
            <Save className="h-3.5 w-3.5" />
            Spremi
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <IshodPoruka ishod={ishod} className="flex-1" />
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-300">{napomena.length}/100</span>
        </div>
      </SekcijaTijelo>
    </Sekcija>
  );
}

function PosljednjiBroj() {
  const [numeracija, setNumeracija] = useState<Numeracija | null>(null);
  const [unos, setUnos] = useState('');
  const [ishod, setIshod] = useState<Ishod>(null);

  const ucitaj = async () => {
    try {
      const n = await window.api.getFiskalnaNumeracija();
      setNumeracija(n);
      setUnos(String(n.predvidjeni != null ? n.predvidjeni - 1 : ''));
    } catch { /* postavka nije kritična za rad ekrana */ }
  };

  useEffect(() => { ucitaj(); }, []);

  const spremi = async () => {
    setIshod(null);
    try {
      const r = await window.api.setZadnjiFiskalniBroj(parseInt(unos, 10));
      await ucitaj();
      setIshod({ ok: true, tekst: r.predvidjeni != null ? `Sljedeći isječak se očekuje pod br. ${r.predvidjeni}.` : 'Broj je spremljen.' });
    } catch (err) {
      setIshod({ ok: false, tekst: porukaGreske(err) });
    }
  };

  const nepromijenjen = numeracija != null && parseInt(unos, 10) + 1 === numeracija.predvidjeni;
  const nedostaje = numeracija != null && numeracija.predvidjeni == null;

  return (
    <Sekcija naslov="Posljednji fiskalni broj" opis="Faktura upisuje broj isječka u naziv stavke, pa ga mora znati unaprijed.">
      <SekcijaTijelo>
        <div className="flex items-end gap-2">
          <Polje label="Zadnji izdati" htmlFor="fiskalni-broj" className="w-36">
            <Input
              id="fiskalni-broj"
              value={unos}
              onChange={e => { setUnos(e.target.value.replace(/\D/g, '')); setIshod(null); }}
              onKeyDown={e => { if (e.key === 'Enter' && unos && !nepromijenjen) spremi(); }}
              inputMode="numeric"
              maxLength={9}
              className={cn(POLJE, 'w-36 font-mono tabular-nums', nedostaje && 'border-amber-300 bg-amber-50/50')}
            />
          </Polje>
          <Button size="sm" variant="outline" onClick={spremi} disabled={!unos || nepromijenjen}
            className="h-9 gap-1.5 text-[12px] border-slate-200">
            <Save className="h-3.5 w-3.5" />
            Spremi broj
          </Button>
          {numeracija?.predvidjeni != null && (
            <div className="ml-auto text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sljedeći isječak</span>
              <span className="mt-1 block font-mono text-[18px] font-semibold tabular-nums leading-none text-slate-800">
                {numeracija.predvidjeni}
              </span>
            </div>
          )}
        </div>
        <IshodPoruka ishod={ishod} className="mt-3" />
        <p className={cn('mt-3 text-[12px] leading-relaxed', nedostaje ? 'text-amber-700' : 'text-slate-500')}>
          {numeracija == null
            ? 'Učitavanje…'
            : nedostaje
              ? 'U bazi nema fiskalizovanih računa i broj nije upisan. Faktura se ne može odštampati dok ne upišete posljednji broj sa uređaja.'
              : (numeracija.zadnjiUBazi != null
                ? `Posljednji fiskalizovan račun u bazi nosi br. ${numeracija.zadnjiUBazi}.`
                : 'U bazi još nema fiskalizovanih računa.')
                + ' Ručni upis važi dok kroz program ne prođe sljedeći račun.'}
        </p>
      </SekcijaTijelo>
    </Sekcija>
  );
}

function vrijeme(ts: string | number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Bilježenje Tring XML-a i pregled zapisa — za podršku, kad uređaj vraća greške. */
function Dijagnostika() {
  const [ukljuceno, setUkljuceno] = useState<boolean | null>(null);
  const [zapisi, setZapisi] = useState<any[]>([]);
  const [ucitavam, setUcitavam] = useState(false);
  const [otvoren, setOtvoren] = useState<number | null>(null);

  useEffect(() => {
    window.api.getSetting('dev.logging').then((v) => setUkljuceno(v === 'true'));
  }, []);

  const ucitaj = async () => {
    setUcitavam(true);
    try {
      const logs = await window.api.tringGetLogs();
      setZapisi(logs.reverse());
    } catch { /* ignore */ }
    setUcitavam(false);
  };

  const ocisti = async () => {
    await window.api.tringClearLogs();
    setZapisi([]);
  };

  return (
    <Sekcija
      naslov="Dijagnostika"
      akcije={ukljuceno && (
        <>
          {zapisi.length > 0 && (
            <Button variant="ghost" size="sm" onClick={ocisti} className="h-8 gap-1.5 text-[12px] text-slate-500 hover:text-rose-600 hover:bg-rose-50">
              <Trash2 className="h-3.5 w-3.5" />
              Očisti
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={ucitaj} disabled={ucitavam} className="h-8 gap-1.5 text-[12px] border-slate-200">
            <RefreshCw className={cn('h-3.5 w-3.5', ucitavam && 'animate-spin')} />
            Učitaj zapise
          </Button>
        </>
      )}
    >
      <PrekidacRed
        id="postavka-dev-logging"
        naslov="Bilježi komunikaciju s uređajem"
        opis="Čuva XML zahtjeve i odgovore Tring servera u memoriji, dok se program ne zatvori. Uključiti samo za traženje greške."
        checked={ukljuceno ?? false}
        disabled={ukljuceno == null}
        onChange={async (v) => {
          setUkljuceno(v);
          await window.api.setSetting('dev.logging', String(v));
        }}
      />

      {ukljuceno && (
        zapisi.length === 0 ? (
          <p className="px-5 py-6 text-center text-[12px] text-slate-400 border-t border-slate-100">
            Nema zapisa. Pošaljite komandu uređaju pa kliknite „Učitaj zapise“.
          </p>
        ) : (
          <div className="border-t border-slate-100 max-h-[480px] overflow-y-auto">
            {zapisi.map((log) => {
              const otvorenRed = otvoren === log.id;
              const ok = log.parsed?.success;
              return (
                <div key={log.id} className="border-b border-slate-100 last:border-b-0">
                  <button
                    onClick={() => setOtvoren(otvorenRed ? null : log.id)}
                    aria-expanded={otvorenRed}
                    className="w-full px-5 py-2.5 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors focus:outline-none focus-visible:bg-slate-50"
                  >
                    <span aria-hidden className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', ok ? 'bg-emerald-500' : 'bg-rose-500')} />
                    <span className="w-[60px] flex-shrink-0 font-mono text-[11px] tabular-nums text-slate-400">{vrijeme(log.timestamp)}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-slate-700">{log.path}</span>
                    <span className={cn('flex-shrink-0 font-mono text-[11px]', ok ? 'text-slate-500' : 'text-rose-600')}>
                      {log.statusCode ?? '—'} {log.parsed?.vrstaOdgovora}
                    </span>
                    <span className="w-[52px] flex-shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-300">{log.durationMs} ms</span>
                    <ChevronDown size={14} className={cn('flex-shrink-0 text-slate-300 transition-transform', otvorenRed && 'rotate-180')} />
                  </button>

                  {otvorenRed && (
                    <div className="px-5 pb-4 space-y-3">
                      {log.parsed && (
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-slate-50 p-3 font-mono text-[11px]">
                          <dt className="text-slate-400">success</dt>
                          <dd className={ok ? 'text-emerald-600' : 'text-rose-600'}>{String(log.parsed.success)}</dd>
                          <dt className="text-slate-400">vrstaOdgovora</dt>
                          <dd className="text-slate-700">{log.parsed.vrstaOdgovora}</dd>
                          {log.parsed.error && (<><dt className="text-slate-400">error</dt><dd className="text-rose-600">{log.parsed.error}</dd></>)}
                          {log.parsed.odgovori && Object.entries(log.parsed.odgovori).map(([k, v]) => (
                            <Fragment key={k}>
                              <dt className="pl-2 text-slate-500">{k}</dt>
                              <dd className="text-slate-800">{v as string}</dd>
                            </Fragment>
                          ))}
                        </dl>
                      )}
                      <XmlBlok naslov="Zahtjev" xml={log.requestXml} />
                      <XmlBlok naslov="Odgovor" xml={log.responseXml || '(prazno — uređaj nije odgovorio)'} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </Sekcija>
  );
}

function XmlBlok({ naslov, xml }: { naslov: string; xml: string }) {
  return (
    <div>
      <span className="block mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{naslov}</span>
      <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[#0f1629] p-3 font-mono text-[11px] text-slate-300 select-text">
        {xml}
      </pre>
    </div>
  );
}
