import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface PendingRow {
  id: number;
  createdAt: string;
  snapshot: {
    ukupno: number;
    stavke: Array<{ naziv: string; kolicina: number; cijena: number }>;
  };
}

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PendingRacuniDialog({ korisnikId }: { korisnikId: number }) {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [broj, setBroj] = useState('');
  const [datum, setDatum] = useState(nowLocalInput());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    const data = await window.api.listPending();
    setRows(data as PendingRow[]);
    setBroj(''); setDatum(nowLocalInput()); setError('');
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = rows[0];
  if (!current) return null;

  const resolve = async () => {
    setError('');
    if (!broj.trim()) { setError('Unesi fiskalni broj sa papirnog računa'); return; }
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-lg" onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Neispravno završen račun</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Ovaj račun je poslan na štampu, ali aplikacija nije potvrdila upis (moguć prekid/pad računara).
            <strong> Provjerite papirni račun.</strong>
          </p>
          <div className="rounded border p-3 text-sm">
            <div className="font-medium mb-1">Stavke:</div>
            <ul className="space-y-0.5">
              {current.snapshot.stavke.map((s, i) => (
                <li key={i} className="flex justify-between">
                  <span>{s.naziv} × {s.kolicina}</span>
                  <span className="font-mono">{(s.cijena * s.kolicina).toFixed(2)}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-between font-semibold mt-2 pt-2 border-t">
              <span>Ukupno</span><span className="font-mono">{current.snapshot.ukupno.toFixed(2)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fiskalni broj (sa papira)</Label>
              <Input value={broj} onChange={e => setBroj(e.target.value)} placeholder="npr. 1234" />
            </div>
            <div>
              <Label>Datum i vrijeme</Label>
              <Input type="datetime-local" value={datum} onChange={e => setDatum(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {rows.length > 1 && <p className="text-xs text-slate-500">Preostalo nerazriješenih: {rows.length}</p>}
        </div>
        <div className="flex justify-between gap-2 mt-2">
          <Button variant="outline" onClick={discard} disabled={loading}>Nije odštampan — odbaci</Button>
          <Button onClick={resolve} disabled={loading}>Odštampan — sačuvaj</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
