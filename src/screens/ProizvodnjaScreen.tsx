// src/screens/ProizvodnjaScreen.tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RadniNalog, NalogStatus } from '@/types';
import { formatBrojNaloga } from '@/lib/proizvodnja';
import { cn, formatKM, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ActionRow, Eyebrow, LedgerHead, SegmentedFilter } from '@/components/ui/ledger';
import { NalogDialog } from '@/components/proizvodnja/NalogDialog';
import { StavkeUtroska } from '@/components/proizvodnja/StavkeUtroska';
import { KalkulacijaPanel } from '@/components/proizvodnja/KalkulacijaPanel';
import { IzdajRacunDialog } from '@/components/proizvodnja/IzdajRacunDialog';
import { NormativiTab } from '@/components/proizvodnja/NormativiTab';
import type { Kalkulacija } from '@/lib/proizvodnja';
import {
  RefreshCw, Plus, Pencil, Trash2, Hammer, ClipboardList, AlertTriangle, X, Factory, Play,
  CheckCircle2, Undo2, Receipt,
} from 'lucide-react';

export const STATUS_META: Record<NalogStatus, { label: string; cls: string }> = {
  otvoren: { label: 'Otvoren', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  u_izradi: { label: 'U izradi', cls: 'bg-blue-50 text-blue-600 border-blue-100' },
  zavrsen: { label: 'Završen', cls: 'bg-emerald-50 text-emerald-600 border-emerald-100' },
  fakturisan: { label: 'Fakturisan', cls: 'bg-violet-50 text-violet-600 border-violet-100' },
};

export function StatusChip({ status, size = 'sm' }: { status: NalogStatus; size?: 'sm' | 'md' }) {
  const m = STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center rounded-full font-semibold border text-[10px]', size === 'sm' ? 'px-2 py-0.5' : 'px-2.5 py-1', m.cls)}>
      {m.label}
    </span>
  );
}

type Filter = 'aktivni' | 'otvoren' | 'u_izradi' | 'zavrsen' | 'fakturisan' | 'sve';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'aktivni', label: 'Aktivni' },
  { id: 'otvoren', label: 'Otvoreni' },
  { id: 'u_izradi', label: 'U izradi' },
  { id: 'zavrsen', label: 'Završeni' },
  { id: 'fakturisan', label: 'Fakturisani' },
  { id: 'sve', label: 'Svi' },
];

type Tab = 'nalozi' | 'normativi';

export default function ProizvodnjaScreen({ korisnikId, uloga, initialNalogId }: {
  korisnikId: number; uloga: 'admin' | 'kasir'; initialNalogId?: number | null;
}) {
  const [tab, setTab] = useState<Tab>('nalozi');
  const [nalozi, setNalozi] = useState<RadniNalog[]>([]);
  const [selected, setSelected] = useState<RadniNalog | null>(null);
  const [filter, setFilter] = useState<Filter>('aktivni');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editNalog, setEditNalog] = useState<RadniNalog | null>(null);
  const [brisiOpen, setBrisiOpen] = useState(false);
  const [kalk, setKalk] = useState<Kalkulacija | null>(null);
  const [zavrsiOpen, setZavrsiOpen] = useState(false);
  const [vratiOpen, setVratiOpen] = useState(false);
  const [racunOpen, setRacunOpen] = useState(false);

  const load = useCallback(async () => {
    setNalozi(await window.api.getNalozi());
  }, []);
  useEffect(() => { load(); }, [load]);

  const select = useCallback(async (id: number) => {
    try {
      const n = await window.api.getNalog(id);
      setSelected(n);
      setKalk(await window.api.getNalogKalkulacija(id));
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  }, []);

  useEffect(() => { if (initialNalogId) { setTab('nalozi'); select(initialNalogId); } }, [initialNalogId, select]);

  const refreshSelected = useCallback(async () => {
    await load();
    if (selected) await select(selected.id);
  }, [load, select, selected]);

  const visible = useMemo(() => nalozi.filter(n =>
    filter === 'sve' ? true : filter === 'aktivni' ? n.status !== 'fakturisan' : n.status === filter
  ), [nalozi, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { sve: nalozi.length, aktivni: 0 };
    for (const n of nalozi) { c[n.status] = (c[n.status] ?? 0) + 1; if (n.status !== 'fakturisan') c.aktivni++; }
    return c;
  }, [nalozi]);

  const uredivo = selected && (selected.status === 'otvoren' || selected.status === 'u_izradi');

  const uIzradu = async () => {
    if (!selected) return;
    try {
      await window.api.setNalogStatus({ id: selected.id, status: 'u_izradi', korisnikId });
      await refreshSelected();
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  };

  const obrisi = async () => {
    if (!selected) return;
    try {
      await window.api.deleteNalog(selected.id);
      setBrisiOpen(false); setSelected(null); await load();
      setMsg({ type: 'success', text: 'Nalog obrisan' });
    } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); }
  };

  return (
    <div className="flex flex-col h-full bg-[#f4f6f9]">
      <div className="flex-shrink-0 bg-white border-b border-slate-200/80 px-6 py-3.5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-[15px] font-semibold text-slate-800 tracking-tight">Proizvodnja</h2>
            <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1">
              {([['nalozi', 'Radni nalozi', Hammer], ['normativi', 'Normativi', ClipboardList]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-medium', tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            {tab === 'nalozi' && <SegmentedFilter options={FILTERS} value={filter} onChange={setFilter} counts={counts} />}
          </div>
          {tab === 'nalozi' && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={load} className="h-8 gap-1.5 text-[12px]"><RefreshCw className="h-3.5 w-3.5" /> Osvježi</Button>
              <Button size="sm" onClick={() => { setEditNalog(null); setFormOpen(true); }} className="h-8 gap-1.5 text-[12px]"><Plus className="h-3.5 w-3.5" /> Novi nalog</Button>
            </div>
          )}
        </div>
      </div>

      {msg && (
        <div className={cn('mx-5 mt-4 flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[12px] font-medium',
          msg.type === 'error' ? 'bg-rose-50/70 border-rose-200 text-rose-700' : 'bg-emerald-50/70 border-emerald-200 text-emerald-700')}>
          {msg.type === 'error' ? <AlertTriangle size={14} /> : <Factory size={14} />}
          {msg.text}
          <button className="ml-auto text-slate-400 hover:text-slate-600" onClick={() => setMsg(null)}><X size={13} /></button>
        </div>
      )}

      {tab === 'normativi' ? (
        <NormativiTab />
      ) : (
        <div className="flex-1 min-h-0 flex gap-4 p-5 overflow-hidden">
          {/* Lista */}
          <div className="flex-1 min-w-0">
            <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
              {visible.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                  <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3"><Hammer size={20} className="text-slate-300" /></div>
                  <p className="text-[13px] font-medium text-slate-500">Nema radnih naloga</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">Otvorite nalog za kupca ili za zalihu.</p>
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <table className="w-full border-separate border-spacing-0">
                    <LedgerHead columns={[
                      { label: 'Broj', className: 'text-left pl-5 pr-2 w-[100px]' },
                      { label: 'Datum', className: 'text-left px-2 w-[90px]' },
                      { label: 'Vrsta', className: 'text-left px-2 w-[90px]' },
                      { label: 'Kupac / proizvod', className: 'text-left px-2' },
                      { label: 'Rok', className: 'text-left px-2 w-[90px]' },
                      { label: 'Cijena', className: 'text-right px-2 w-[110px]' },
                      { label: 'Status', className: 'text-right pr-5 pl-2 w-[110px]' },
                    ]} />
                    <tbody>
                      {visible.map(n => {
                        const isSel = selected?.id === n.id;
                        return (
                          <tr key={n.id} onClick={() => select(n.id)}
                            className={cn('cursor-pointer transition-colors', isSel ? 'bg-blue-50/80' : 'hover:bg-slate-50')}>
                            <td className={cn('pl-5 pr-2 py-2.5 border-b border-slate-100 font-mono text-[11.5px] font-semibold tabular-nums',
                              isSel ? 'text-blue-600 shadow-[inset_3px_0_0_0_#2563eb]' : 'text-slate-500')}>{formatBrojNaloga(n)}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[12px] text-slate-500 tabular-nums">{formatDate(n.datum)}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[11px] text-slate-500">{n.vrsta === 'narudzba' ? 'Narudžba' : 'Zaliha'}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[12px] text-slate-700 truncate max-w-[260px]">
                              {n.vrsta === 'narudzba' ? (n.kupacNaziv || '—') : `${n.productNaziv} × ${n.kolicina}`}
                              <span className="block text-[10.5px] text-slate-400 truncate">{n.opis}</span>
                            </td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-[12px] text-slate-400 tabular-nums">{n.rok ? formatDate(n.rok) : '—'}</td>
                            <td className="px-2 py-2.5 border-b border-slate-100 text-right font-mono text-[12.5px] font-semibold tabular-nums text-slate-800">
                              {n.dogovorenaCijena != null ? formatKM(n.dogovorenaCijena) : '—'}
                            </td>
                            <td className="pr-5 pl-2 py-2.5 border-b border-slate-100 text-right"><StatusChip status={n.status} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </div>
          </div>

          {/* Detalj */}
          <div className="w-[460px] flex-shrink-0">
            {selected ? (
              <div className="bg-white rounded-2xl border border-slate-200/70 shadow-sm shadow-slate-200/40 h-full flex flex-col overflow-hidden">
                <div className="flex-shrink-0 px-5 pt-5 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Eyebrow>{selected.vrsta === 'narudzba' ? 'Radni nalog po narudžbi' : 'Radni nalog za zalihu'}</Eyebrow>
                      <h3 className="text-[19px] font-bold font-mono tracking-tight text-slate-900 leading-tight mt-1">{formatBrojNaloga(selected)}</h3>
                      <p className="text-[11.5px] text-slate-400 mt-0.5 tabular-nums">
                        {formatDate(selected.datum)}{selected.rok ? ` · rok ${formatDate(selected.rok)}` : ''}
                      </p>
                    </div>
                    <StatusChip status={selected.status} size="md" />
                  </div>
                </div>

                <div className="flex-shrink-0 px-5 pb-3">
                  <dl className="rounded-xl bg-slate-50/80 border border-slate-100 px-4 py-3 space-y-1.5 text-[12px]">
                    {selected.vrsta === 'narudzba' ? (
                      <div className="flex justify-between gap-3"><dt className="text-slate-400">Kupac</dt><dd className="font-medium text-slate-700 text-right truncate">{selected.kupacNaziv || '—'}</dd></div>
                    ) : (
                      <div className="flex justify-between gap-3"><dt className="text-slate-400">Proizvod</dt><dd className="font-medium text-slate-700 text-right truncate">{selected.productNaziv} × {selected.kolicina}</dd></div>
                    )}
                    <div className="flex justify-between gap-3"><dt className="text-slate-400">Opis</dt><dd className="text-slate-700 text-right">{selected.opis}</dd></div>
                    {selected.ponudaBroj && (
                      <div className="flex justify-between gap-3"><dt className="text-slate-400">Iz ponude</dt><dd className="font-mono text-slate-600">{selected.ponudaBroj}/{selected.ponudaGodina}</dd></div>
                    )}
                    {selected.racunBroj && (
                      <div className="flex justify-between gap-3"><dt className="text-violet-400">Fiskalni račun</dt>
                        <dd className="font-mono font-medium text-violet-600">#{selected.racunBroj}{selected.racunStatus === 'refunded' ? ' · stornirano' : ''}</dd></div>
                    )}
                    {selected.napomena && <p className="pt-1.5 border-t border-slate-200/70 text-[11.5px] text-slate-500">{selected.napomena}</p>}
                  </dl>
                </div>

                <div className="flex-1 min-h-0 border-t border-slate-100">
                  <StavkeUtroska
                    nalogId={selected.id}
                    stavke={selected.stavke ?? []}
                    uredivo={!!uredivo}
                    onSave={async (stavke) => { await window.api.saveNalogStavke(selected.id, stavke); await select(selected.id); }}
                  />
                </div>
                <KalkulacijaPanel
                  nalog={selected} kalkulacija={kalk} uredivo={!!uredivo}
                  onTrosakRada={async (iznos) => { await window.api.updateNalog(selected.id, { trosakRada: iznos }); await select(selected.id); }}
                />

                <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3.5 space-y-2">
                  {selected.status === 'otvoren' && <ActionRow icon={Play} label="U izradu" onClick={uIzradu} />}
                  {uredivo && (selected.stavke?.length ?? 0) > 0 && (
                    <ActionRow icon={CheckCircle2} label="Završi nalog" tone="primary" onClick={() => setZavrsiOpen(true)} />
                  )}
                  {selected.status === 'zavrsen' && selected.vrsta === 'narudzba' && (
                    <ActionRow icon={Receipt} label="Izdaj račun" tone="primary" onClick={() => setRacunOpen(true)} />
                  )}
                  {selected.status === 'zavrsen' && uloga === 'admin' && (
                    <ActionRow icon={Undo2} label="Vrati u izradu" onClick={() => setVratiOpen(true)} />
                  )}
                  {uredivo && <ActionRow icon={Pencil} label="Uredi zaglavlje" onClick={() => { setEditNalog(selected); setFormOpen(true); }} />}
                  {uredivo && <ActionRow icon={Trash2} label="Obriši nalog" tone="danger" onClick={() => setBrisiOpen(true)} />}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-[12.5px] text-slate-400 bg-white/60 rounded-2xl border border-dashed border-slate-200">
                Odaberite nalog iz liste
              </div>
            )}
          </div>
        </div>
      )}

      <NalogDialog open={formOpen} onOpenChange={setFormOpen} korisnikId={korisnikId} nalog={editNalog}
        onSaved={async (id) => { await load(); await select(id); setMsg({ type: 'success', text: editNalog ? 'Nalog izmijenjen' : 'Nalog otvoren' }); }} />

      {selected && (
        <IzdajRacunDialog open={racunOpen} onOpenChange={setRacunOpen} nalog={selected} korisnikId={korisnikId}
          onIzdat={async (bf) => { await refreshSelected(); setMsg({ type: 'success', text: `Račun #${bf ?? ''} izdat po nalogu ${formatBrojNaloga(selected)}` }); }} />
      )}

      <Dialog open={brisiOpen} onOpenChange={setBrisiOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Obrisati nalog {selected ? formatBrojNaloga(selected) : ''}?</DialogTitle>
            <DialogDescription>Nalog nije završen pa ništa nije knjiženo. Brisanje se ne može poništiti.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setBrisiOpen(false)}>Otkaži</Button>
            <Button variant="destructive" onClick={obrisi}>Obriši</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={zavrsiOpen} onOpenChange={setZavrsiOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Završiti nalog {selected ? formatBrojNaloga(selected) : ''}?</DialogTitle>
            <DialogDescription>
              Materijal se skida sa skladišta po stavkama utroška i nabavne cijene se zamrzavaju.
              {selected?.vrsta === 'zaliha' && ` Na stanje ulazi ${selected.kolicina} × ${selected.productNaziv}.`}
            </DialogDescription>
          </DialogHeader>
          {kalk && kalk.upozorenja.length > 0 && (
            <div className="rounded-lg bg-amber-50/70 border border-amber-100 px-3 py-2 space-y-0.5">
              {kalk.upozorenja.map((u, i) => <p key={i} className="text-[11.5px] text-amber-700">{u}</p>)}
              <p className="text-[11px] text-amber-600/80 pt-1">Završetak nije blokiran — stanje će ići u minus dok se ne unese primka.</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setZavrsiOpen(false)}>Otkaži</Button>
            <Button onClick={async () => {
              if (!selected) return;
              try {
                await window.api.setNalogStatus({ id: selected.id, status: 'zavrsen', korisnikId });
                setZavrsiOpen(false); await refreshSelected();
                setMsg({ type: 'success', text: `Nalog ${formatBrojNaloga(selected)} završen, materijal razdužen` });
              } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); setZavrsiOpen(false); }
            }}>Završi i razduži</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={vratiOpen} onOpenChange={setVratiOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Vratiti nalog u izradu?</DialogTitle>
            <DialogDescription>Knjiženja završetka se brišu (materijal se vraća na stanje), stavke se otključavaju.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setVratiOpen(false)}>Otkaži</Button>
            <Button onClick={async () => {
              if (!selected) return;
              try {
                await window.api.setNalogStatus({ id: selected.id, status: 'vrati', korisnikId });
                setVratiOpen(false); await refreshSelected();
              } catch (e: any) { setMsg({ type: 'error', text: e?.message || 'Greška' }); setVratiOpen(false); }
            }}>Vrati u izradu</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
