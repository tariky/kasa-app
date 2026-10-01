import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { naOtvaranjeNezavrsenih } from '@/lib/nezavrseniRacuni';
import { localDateTimeInput } from '@/lib/novac';

interface PendingRow {
  id: number;
  createdAt: string;
  snapshot: {
    /** Bez vrste: račun sa kase ili faktura (lib/pendingRacun.ts). */
    vrsta?: 'ponuda' | 'nalog' | 'storno';
    ukupno: number;
    stavke: Array<{ naziv?: string; kolicina: number; cijena: number; rabat?: number }>;
    /** Račun po prilogu: na uređaj ide jedna zbirna stavka s ovim nazivom. */
    prilogNaziv?: string | null;
    ponudaBroj?: number; ponudaGodina?: number; nalogId?: number;
    nalogBroj?: number; nalogGodina?: number;
    /** Storno: fiskalni broj računa koji se stornira. */
    brojRacuna?: string | null;
  };
}

/** Šta je poslano na štampu — naslov i polje za broj s papira zavise od vrste. */
function opisZapisa(snap: PendingRow['snapshot']): { naslov: string; dokument: string; brojLabel: string } {
  switch (snap.vrsta) {
    case 'ponuda':
      return {
        naslov: `Neispravno završen račun po ponudi br. ${snap.ponudaBroj}/${snap.ponudaGodina}`,
        dokument: snap.nalogId != null ? 'Račun po ponudi (izdat iz radnog naloga)' : 'Račun po ponudi',
        brojLabel: 'Fiskalni broj (sa papira)',
      };
    case 'nalog':
      return {
        naslov: `Neispravno završen račun za radni nalog br. ${snap.nalogBroj}/${snap.nalogGodina}`,
        dokument: 'Račun za radni nalog', brojLabel: 'Fiskalni broj (sa papira)',
      };
    case 'storno':
      return {
        naslov: `Neispravno završen storno računa BF ${snap.brojRacuna ?? '?'}`,
        dokument: 'Storno (reklamacija)', brojLabel: 'Broj reklamacije (sa papira)',
      };
    default:
      return { naslov: 'Neispravno završen račun', dokument: 'Račun', brojLabel: 'Fiskalni broj (sa papira)' };
  }
}

export default function PendingRacuniDialog({ uloga }: { uloga: 'admin' | 'kasir' }) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [broj, setBroj] = useState('');
  const [datum, setDatum] = useState(localDateTimeInput);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await window.api.listPending();
    setRows(data as PendingRow[]);
    setBroj(''); setDatum(localDateTimeInput()); setError('');
  }, []);

  useEffect(() => { load(); }, [load]);
  // Nepoznat ishod štampe: ekran traži da se dijalog otvori odmah.
  useEffect(() => naOtvaranjeNezavrsenih(() => { load(); }), [load]);

  const current = rows[0];
  if (!current) return null;
  const opis = opisZapisa(current.snapshot);

  const resolve = async () => {
    setError('');
    if (!broj.trim()) {
      setError(current.snapshot.vrsta === 'storno' ? 'Unesi broj reklamacije sa papira' : 'Unesi fiskalni broj sa papirnog računa');
      return;
    }
    setLoading(true);
    try {
      await window.api.resolvePending({ id: current.id, brojFiskalnogRacuna: broj.trim(), createdAt: datum.replace('T', ' ') + ':00' });
      await load();
    } catch (e: any) {
      setError(e?.message || 'Greška');
    } finally {
      setLoading(false);
    }
  };

  const discard = async () => {
    setLoading(true);
    try {
      await window.api.discardPending(current.id);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Greška');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-lg" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{opis.naslov}</DialogTitle>
        </DialogHeader>
        {/* Tijelo do rubova dijaloga: traka za skrol uz rub, prsten fokusa polja nije odsječen. */}
        <DialogBody className="-mx-6 px-6 -mb-1 pb-1 space-y-4">
          <p className="text-sm text-slate-600">
            {opis.dokument} je poslan na štampu, ali aplikacija nije potvrdila upis (uređaj nije odgovorio ili je
            došlo do prekida/pada računara).
            <strong> Provjerite papirni isječak.</strong>
            {current.snapshot.vrsta === 'storno' && ' Ako je odštampan, račun se stornira i roba vraća na stanje.'}
          </p>
          <div className="rounded border p-3 text-sm">
            <div className="font-medium mb-1">Stavke:</div>
            <ul className="space-y-0.5">
              {current.snapshot.stavke.length === 0 && current.snapshot.prilogNaziv && (
                <li className="flex justify-between">
                  <span>{current.snapshot.prilogNaziv}</span>
                  <span className="font-mono">{current.snapshot.ukupno.toFixed(2)}</span>
                </li>
              )}
              {current.snapshot.stavke.map((s, i) => (
                <li key={i} className="flex justify-between">
                  <span>{s.naziv ?? ''} × {s.kolicina}</span>
                  <span className="font-mono">{(s.cijena * s.kolicina * (1 - (s.rabat ?? 0) / 100)).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
              <span>Ukupno</span><span className="font-mono">{current.snapshot.ukupno.toFixed(2)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{opis.brojLabel}</Label>
              <Input value={broj} onChange={e => setBroj(e.target.value)} placeholder="npr. 1234" />
            </div>
            <div>
              <Label>Datum i vrijeme</Label>
              <Input type="datetime-local" value={datum} onChange={e => setDatum(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {rows.length > 1 && <p className="text-xs text-slate-500">Preostalo nerazriješenih: {rows.length}</p>}
        </DialogBody>
        <div className="shrink-0 flex justify-between gap-2 mt-2">
          {/* Odbacivanje briše jedini trag računa — samo administrator (provjera je i u main procesu). */}
          {uloga === 'admin'
            ? <Button variant="outline" onClick={discard} disabled={loading}>Nije odštampan — odbaci</Button>
            : <p className="self-center text-xs text-slate-500">Ako račun nije odštampan, odbacuje ga administrator.</p>}
          <Button onClick={resolve} disabled={loading}>Odštampan — sačuvaj</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
