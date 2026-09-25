import { useEffect, useState, type ReactNode } from 'react';
import { pdf } from '@react-pdf/renderer';
import { AlertTriangle, CheckCircle2, Download, FileArchive, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PeriodPicker } from '@/components/ui/period-picker';
import { KnjigovodjaPdf } from '@/components/KnjigovodjaPdf';
import { useModuli } from '@/hooks/useModuli';
import { cn, formatKM, mnozina, porukaGreske } from '@/lib/utils';
import { localDateStr } from '@/lib/novac';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';
import { obracunaj, type KnjigovodjaIzvjestaj, type Moduli } from '@/lib/knjigovodja/obracun';
import { listoviIzvjestaja } from '@/lib/knjigovodja/listovi';
import { imeFajla, periodMjeseca, prikazDatuma, prikazPerioda, prosliMjesec, type Period } from '@/lib/knjigovodja/period';
import { zapakuj } from '@/lib/knjigovodja/zip';
import type { FirmaSettings } from '@/types';

/** Koliko upozorenja se vidi na ekranu; ostala su u listu „Kontrola“. */
const VIDLJIVA_UPOZORENJA = 8;

function pocetniPeriod(): Period {
  const { godina, mjesec } = prosliMjesec(new Date());
  return periodMjeseca(godina, mjesec);
}

function odbaceneIzPostavke(v: string | null): number[] {
  if (!v) return [];
  try {
    const niz = JSON.parse(v);
    return Array.isArray(niz) ? niz.filter((x): x is number => typeof x === 'number') : [];
  } catch {
    return []; // pokvarena postavka ne smije srušiti izvoz — rupe se tada samo prikažu
  }
}

const KARTICA = 'bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50';

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('rounded bg-slate-100 animate-pulse', className)} />;
}

function Kartica({ naziv, iznos, ceka, negativno, children }: {
  naziv: string;
  iznos?: number;
  ceka: boolean;
  negativno?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn(KARTICA, 'p-5')}>
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{naziv}</span>
      {iznos !== undefined && (
        ceka ? <Skeleton className="h-[22px] w-36 mt-3" /> : (
          <p className={cn(
            'mt-3 text-[22px] font-bold font-mono tabular-nums tracking-tight leading-none',
            negativno && iznos !== 0 ? 'text-red-500' : 'text-slate-900',
          )}>
            {formatKM(iznos)}
          </p>
        )
      )}
      {children && (
        <dl className={cn('space-y-1', iznos !== undefined ? 'mt-3 pt-3 border-t border-slate-50' : 'mt-3')}>
          {ceka ? <><Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-2/3" /></> : children}
        </dl>
      )}
    </div>
  );
}

function Detalj({ label, value, jako }: { label: string; value: string; jako?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[12px] text-slate-500">{label}</dt>
      <dd className={cn(
        'font-mono tabular-nums text-right',
        jako ? 'text-[15px] font-semibold text-slate-900' : 'text-[12px] text-slate-600',
      )}>
        {value}
      </dd>
    </div>
  );
}

export default function KnjigovodjaTab() {
  const moduli = useModuli();
  const [period, setPeriod] = useState<Period>(pocetniPeriod);
  const [izvjestaj, setIzvjestaj] = useState<KnjigovodjaIzvjestaj | null>(null);
  const [firma, setFirma] = useState<FirmaSettings | null>(null);
  const [ucitavanje, setUcitavanje] = useState(false);
  const [izvozi, setIzvozi] = useState(false);
  const [greska, setGreska] = useState('');
  const [snimljeno, setSnimljeno] = useState('');

  // Zavisnosti su zastavice, ne objekat: useLicenca se osvježava svaki sat i
  // daje novi objekat, a to ne smije ponovo učitavati izvještaj.
  const spreman = moduli !== null;
  const skladiste = moduli?.ukljuceni.skladiste ?? false;
  const proizvodnja = moduli?.ukljuceni.proizvodnja ?? false;

  useEffect(() => {
    if (!spreman) return;
    let aktuelno = true;
    setUcitavanje(true);
    setGreska('');
    setSnimljeno('');
    Promise.all([
      window.api.izvozKnjigovodja(period.od, period.do),
      window.api.getFirmaSettings(),
      window.api.getSetting('fiscal.dismissedGaps'),
    ])
      .then(([podaci, f, odbacene]) => {
        if (!aktuelno) return;
        setFirma(f);
        setIzvjestaj(obracunaj(podaci, {
          moduli: { skladiste, proizvodnja },
          odbacenePraznine: odbaceneIzPostavke(odbacene),
          danas: localDateStr(),
        }));
      })
      .catch(e => { if (aktuelno) { setIzvjestaj(null); setGreska(`Podaci za period nisu učitani: ${porukaGreske(e)}`); } })
      .finally(() => { if (aktuelno) setUcitavanje(false); });
    return () => { aktuelno = false; };
  }, [period, spreman, skladiste, proizvodnja]);

  const izvezi = async () => {
    if (!izvjestaj || !firma) return;
    setIzvozi(true);
    setGreska('');
    setSnimljeno('');
    try {
      const izvezeno = new Date();
      const ime = imeFajla(firma.naziv, period);
      // exceljs je velik — učitava se tek kad zatreba.
      const { napraviExcel } = await import('@/lib/knjigovodja/excel');
      const [xlsx, pdfBlob] = await Promise.all([
        napraviExcel(izvjestaj, firma, izvezeno),
        pdf(<KnjigovodjaPdf izvjestaj={izvjestaj} firma={firma} izvezeno={izvezeno} />).toBlob(),
      ]);
      const zip = zapakuj([
        { ime: `${ime}.xlsx`, bajtovi: xlsx },
        { ime: `${ime}.pdf`, bajtovi: new Uint8Array(await pdfBlob.arrayBuffer()) },
      ]);
      const putanja = await window.api.showSaveDialog({ defaultName: `${ime}.zip`, filters: [{ name: 'ZIP arhiva', extensions: ['zip'] }] });
      if (!putanja) return; // korisnik otkazao
      await window.api.writeFile(putanja, zip);
      setSnimljeno(putanja);
    } catch (e) {
      setGreska(`Izvoz nije uspio: ${porukaGreske(e)}`);
    } finally {
      setIzvozi(false);
    }
  };

  const z = izvjestaj?.zbir;
  // Dok nema izvještaja, raspored kartica prati module iz licence da se ekran ne pomjera.
  const mod: Moduli = izvjestaj?.moduli ?? { skladiste, proizvodnja };
  const ceka = ucitavanje || (!izvjestaj && !greska);
  const listovi = izvjestaj ? listoviIzvjestaja(izvjestaj) : [];
  const ime = imeFajla(firma?.naziv ?? '', period);
  const upozorenja = izvjestaj?.upozorenja ?? [];
  const bezIzvjestaja = !izvjestaj && !ceka;

  return (
    <ScrollArea className="h-full">
      <div className="px-6 pt-5 pb-8 space-y-5">

        {/* Period i izvoz */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker value={period} onChange={setPeriod} max={localDateStr()} />
          <Button className="h-9 gap-2 min-w-56" onClick={izvezi} disabled={!izvjestaj || ucitavanje || izvozi}>
            {izvozi ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {izvozi ? 'Pripremam ZIP…' : 'Izvezi za knjigovođu (.zip)'}
          </Button>
        </div>

        <div>
          <h2 className="text-[22px] font-bold tracking-tight text-slate-900 leading-tight">{prikazPerioda(period)}</h2>
          <p className="text-[13px] text-slate-500 mt-1">Excel sa svim listovima i PDF rekapitulacija u jednom ZIP fajlu.</p>
        </div>

        {greska && (
          <div role="alert" className="flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-medium bg-red-50/60 border border-red-100 text-red-600">
            <AlertTriangle size={14} className="flex-shrink-0" />
            {greska}
          </div>
        )}

        {snimljeno && (
          <div role="status" className="flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] bg-emerald-50/60 border border-emerald-100 text-emerald-700">
            <CheckCircle2 size={14} className="flex-shrink-0" />
            <span className="font-medium">Snimljeno:</span>
            <span className="font-mono break-all">{snimljeno}</span>
          </div>
        )}

        {!bezIzvjestaja && (
          <>
            {/* Brojevi perioda — isti obračun ide u Excel i PDF */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kartica naziv="Promet" iznos={z?.promet.ukupno ?? 0} ceka={ceka}>
                {z && <>
                  <Detalj label={mnozina(z.promet.brojRacuna, ['Račun', 'Računa', 'Računa'])} value={String(z.promet.brojRacuna)} />
                  <Detalj label={`PDV ${PDV_STOPA_E_PCT}%`} value={formatKM(z.promet.pdvE)} />
                  {z.promet.iznosK !== 0 && <Detalj label="Oslobođeno PDV-a (K)" value={formatKM(z.promet.iznosK)} />}
                </>}
              </Kartica>

              <Kartica naziv="Reklamacije" iznos={z?.reklamacije.ukupno ?? 0} ceka={ceka} negativno>
                {z && <>
                  <Detalj label="Broj" value={String(z.reklamacije.broj)} />
                  <Detalj label={`PDV ${PDV_STOPA_E_PCT}%`} value={formatKM(z.reklamacije.pdvE)} />
                </>}
              </Kartica>

              <Kartica naziv="Neto promet" iznos={z?.neto ?? 0} ceka={ceka}>
                {z && <>
                  <Detalj label="Promet" value={formatKM(z.promet.ukupno)} />
                  <Detalj label="Reklamacije" value={formatKM(z.reklamacije.ukupno)} />
                </>}
              </Kartica>

              <Kartica naziv="Gotovina u kasi" ceka={ceka}>
                {z && <>
                  <Detalj label="Polog" value={formatKM(z.polozi)} jako />
                  <Detalj label="Povrat" value={formatKM(z.povrati)} jako />
                </>}
              </Kartica>

              {mod.skladiste && (
                <Kartica naziv="Ulaz robe" iznos={z?.ulaz.nabavna ?? 0} ceka={ceka}>
                  {z && <>
                    <Detalj label={mnozina(z.ulaz.brojPrimki, ['Primka', 'Primke', 'Primki'])} value={String(z.ulaz.brojPrimki)} />
                    <Detalj label="PDV" value={formatKM(z.ulaz.pdv)} />
                    <Detalj label="Prodajna vrijednost" value={formatKM(z.ulaz.prodajna)} />
                  </>}
                </Kartica>
              )}

              {mod.skladiste && (
                <Kartica naziv={`Zalihe na dan ${prikazDatuma(period.do)}`} iznos={z?.zalihe.nabavna ?? 0} ceka={ceka}>
                  {z && <>
                    <Detalj label="Nabavna vrijednost" value={formatKM(z.zalihe.nabavna)} />
                    <Detalj label="Prodajna vrijednost" value={formatKM(z.zalihe.prodajna)} />
                  </>}
                </Kartica>
              )}

              {mod.proizvodnja && (
                <Kartica naziv="Utrošak materijala" iznos={z?.utrosak.vrijednost ?? 0} ceka={ceka}>
                  {z && <Detalj label={mnozina(z.utrosak.brojNaloga, ['Nalog', 'Naloga', 'Naloga'])} value={String(z.utrosak.brojNaloga)} />}
                </Kartica>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2 items-start">
              {/* Sadržaj ZIP-a: tačno ono što knjigovođa dobije */}
              <section className={cn(KARTICA, 'overflow-hidden')} aria-label="Sadržaj izvoza">
                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
                  <FileArchive size={15} className="text-slate-400 flex-shrink-0" />
                  <span className="text-[13px] font-semibold text-slate-700 whitespace-nowrap">Šta ide knjigovođi</span>
                  <span className="ml-auto min-w-0 truncate text-[11px] font-mono text-slate-400" title={`${ime}.zip`}>{ime}.zip</span>
                </div>
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 text-[13px]">
                    <FileSpreadsheet size={15} className="text-emerald-600 flex-shrink-0" />
                    <span className="font-medium text-slate-800">{ime}.xlsx</span>
                    {!ceka && <span className="text-[12px] text-slate-400 whitespace-nowrap">{listovi.length} {mnozina(listovi.length, ['list', 'lista', 'listova'])}</span>}
                  </div>
                  <ul className="mt-2 ml-[7px] border-l border-slate-200 pl-4">
                    {ceka
                      ? Array.from({ length: 6 }, (_, i) => <li key={i} className="py-1.5"><Skeleton className="h-3 w-full" /></li>)
                      : listovi.map(l => (
                        <li key={l.naziv} className="flex items-baseline justify-between gap-3 py-1 text-[12px]">
                          <span className="text-slate-600">{l.naziv}</span>
                          <span className={cn('font-mono tabular-nums whitespace-nowrap', l.redova ? 'text-slate-700' : 'text-slate-300')}>
                            {l.redova} {mnozina(l.redova, ['red', 'reda', 'redova'])}
                          </span>
                        </li>
                      ))}
                  </ul>
                  <div className="flex items-center gap-2 text-[13px] mt-3">
                    <FileText size={15} className="text-red-500 flex-shrink-0" />
                    <span className="font-medium text-slate-800">{ime}.pdf</span>
                    <span className="text-[12px] text-slate-400">rekapitulacija za potpis</span>
                  </div>
                </div>
              </section>

              {/* Kontrola prije slanja */}
              <section aria-label="Kontrola">
                {ceka ? (
                  <div className={cn(KARTICA, 'flex items-center gap-2 px-5 py-4 text-[13px] text-slate-400')}>
                    <Loader2 size={14} className="animate-spin" />
                    Provjeravam račune i zalihe…
                  </div>
                ) : upozorenja.length > 0 ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-5 py-4">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                      <AlertTriangle size={15} className="text-amber-500 flex-shrink-0" />
                      Provjerite prije slanja ({upozorenja.length})
                    </div>
                    <ul className="mt-2.5 space-y-1.5">
                      {upozorenja.slice(0, VIDLJIVA_UPOZORENJA).map((u, i) => (
                        <li key={i} className="flex gap-2 text-[12px] text-amber-900/90 leading-snug">
                          <span className="mt-[7px] h-1 w-1 rounded-full bg-amber-400 flex-shrink-0" />
                          {u.opis}
                        </li>
                      ))}
                    </ul>
                    {upozorenja.length > VIDLJIVA_UPOZORENJA && (
                      <p className="mt-2 text-[12px] text-amber-700">
                        … i još {upozorenja.length - VIDLJIVA_UPOZORENJA} — sva su na listu „Kontrola“ u Excelu.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className={cn(KARTICA, 'flex items-center gap-2 px-5 py-4 text-[13px] text-slate-700')}>
                    <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0" />
                    Nema upozorenja
                  </div>
                )}
                <p className="mt-3 px-1 text-[11px] text-slate-400 leading-relaxed">
                  Z i X izvještaji se vode na fiskalnom uređaju i nisu dio ovog izvoza.
                </p>
              </section>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  );
}
