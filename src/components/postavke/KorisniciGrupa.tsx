import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LedgerHead } from '@/components/ui/ledger';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn, mnozina, porukaGreske } from '@/lib/utils';
import type { User } from '@/types';
import { Pencil, Shield, Trash2, UserPlus, Users } from 'lucide-react';
import { GrupaZaglavlje, IshodPoruka, Polje, Sekcija } from './dijelovi';

const td = 'py-2.5 border-b border-slate-100';

function maskirajPin(pin: string) {
  if (pin.length <= 2) return pin;
  return '•'.repeat(pin.length - 2) + pin.slice(-2);
}

function datum(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}.`;
}

export default function KorisniciGrupa({ onPromjena }: { onPromjena: () => void }) {
  const [korisnici, setKorisnici] = useState<User[]>([]);
  const [greska, setGreska] = useState('');
  const [dialog, setDialog] = useState(false);
  const [uredjuje, setUredjuje] = useState<User | null>(null);
  const [ime, setIme] = useState('');
  const [pin, setPin] = useState('');
  const [uloga, setUloga] = useState<'kasir' | 'admin'>('kasir');

  const ucitaj = async () => setKorisnici(await window.api.getUsers());
  useEffect(() => { ucitaj(); }, []);

  const admina = korisnici.filter(u => u.uloga === 'admin').length;

  const otvori = (u: User | null) => {
    setUredjuje(u);
    setIme(u?.ime ?? '');
    setPin(u?.pin ?? '');
    setUloga(u?.uloga ?? 'kasir');
    setGreska('');
    setDialog(true);
  };

  const spremi = async () => {
    if (!ime.trim() || pin.length < 4) return;
    try {
      if (uredjuje) await window.api.updateUser(uredjuje.id, { ime, pin, uloga });
      else await window.api.createUser({ ime, pin, uloga });
    } catch (err) {
      setGreska(porukaGreske(err));
      return;
    }
    setGreska('');
    setDialog(false);
    await ucitaj();
    onPromjena();
  };

  const obrisi = async (u: User) => {
    if (u.uloga === 'admin' && admina <= 1) return;
    try {
      await window.api.deleteUser(u.id);
      setGreska('');
    } catch (err) {
      setGreska(porukaGreske(err));
    }
    await ucitaj();
    onPromjena();
  };

  return (
    <div className="pb-6">
      <GrupaZaglavlje
        naslov="Korisnici"
        opis="Ko se prijavljuje u program. Postavke i Generator vidi samo administrator."
      />

      <Sekcija
        naslov={korisnici.length
          ? `${korisnici.length} ${mnozina(korisnici.length, ['korisnik', 'korisnika', 'korisnika'])}, od toga ${admina} ${mnozina(admina, ['administrator', 'administratora', 'administratora'])}`
          : 'Korisnici'}
        akcije={
          <Button size="sm" onClick={() => otvori(null)} className="h-8 gap-1.5 text-[12px] bg-[#0f1629] hover:bg-[#1b2540]">
            <UserPlus className="h-3.5 w-3.5" />
            Novi korisnik
          </Button>
        }
      >
        {greska && !dialog && <IshodPoruka ishod={{ ok: false, tekst: greska }} className="px-5 pt-3" />}

        {korisnici.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400 select-none">
            <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
              <Users size={20} className="text-slate-300" />
            </div>
            <p className="text-[13px] font-medium text-slate-500">Još nema korisnika</p>
            <p className="text-[12px] text-slate-400 mt-0.5">Dodajte prvog klikom na „Novi korisnik“.</p>
          </div>
        ) : (
          <table className="w-full border-separate border-spacing-0">
            <LedgerHead columns={[
              { label: 'Ime', className: 'text-left pl-5 pr-3' },
              { label: 'PIN', className: 'text-left px-3 w-[100px]' },
              { label: 'Uloga', className: 'text-left px-3 w-[130px]' },
              { label: 'Dodan', className: 'text-left px-3 w-[110px] hidden md:table-cell' },
              { label: '', className: 'pr-5 pl-2 w-[1%]' },
            ]} />
            <tbody>
              {korisnici.map(u => (
                <tr key={u.id} className="group transition-colors hover:bg-slate-50 [&:last-child>td]:border-b-0">
                  <td className={cn(td, 'pl-5 pr-3 max-w-0')}>
                    <span className="block truncate text-[12.5px] font-medium text-slate-800">{u.ime}</span>
                  </td>
                  <td className={cn(td, 'px-3 font-mono text-[12px] text-slate-400 whitespace-nowrap')}>{maskirajPin(u.pin)}</td>
                  <td className={cn(td, 'px-3 whitespace-nowrap')}>
                    <span className="flex items-center gap-1.5 text-[12px] leading-5 text-slate-600">
                      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', u.uloga === 'admin' ? 'bg-amber-400' : 'bg-slate-300')} />
                      {u.uloga === 'admin' ? 'Administrator' : 'Kasir'}
                    </span>
                  </td>
                  <td className={cn(td, 'hidden md:table-cell px-3 text-[12px] text-slate-400 tabular-nums whitespace-nowrap')}>{datum(u.createdAt)}</td>
                  <td className={cn(td, 'pr-5 pl-2 text-right')}>
                    <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-slate-700"
                        title="Uredi" aria-label={`Uredi ${u.ime}`} onClick={() => otvori(u)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        title={u.uloga === 'admin' && admina <= 1 ? 'Posljednji administrator se ne može obrisati' : 'Obriši'}
                        aria-label={`Obriši ${u.ime}`}
                        onClick={() => obrisi(u)}
                        disabled={u.uloga === 'admin' && admina <= 1}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Sekcija>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-[420px] p-0 gap-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <DialogTitle className="text-lg">{uredjuje ? 'Uredi korisnika' : 'Novi korisnik'}</DialogTitle>
              <DialogDescription className="text-[12px]">
                Korisnik se prijavljuje svojim PIN-om.
              </DialogDescription>
            </DialogHeader>
          </div>

          <Separator />

          <form className="px-6 py-5 space-y-4" onSubmit={e => { e.preventDefault(); spremi(); }}>
            <Polje label="Ime" htmlFor="user-ime">
              <Input id="user-ime" value={ime} onChange={e => setIme(e.target.value)} placeholder="Ime korisnika"
                className="h-10 text-[14px] bg-slate-50 border-slate-200" autoFocus />
            </Polje>
            <Polje label="PIN" htmlFor="user-pin" napomena="Od 4 do 6 cifara.">
              <Input id="user-pin" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                maxLength={6} inputMode="numeric" pattern="[0-9]*" placeholder="••••"
                className="font-mono h-10 text-[14px] bg-slate-50 border-slate-200" />
            </Polje>
            <Polje label="Uloga">
              <div role="radiogroup" aria-label="Uloga" className="grid grid-cols-2 gap-2">
                {(['kasir', 'admin'] as const).map(u => (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={uloga === u}
                    onClick={() => setUloga(u)}
                    className={cn(
                      'h-10 rounded-lg border text-[13px] font-medium transition-colors flex items-center justify-center gap-1.5',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50',
                      uloga === u
                        ? u === 'admin' ? 'border-amber-400 bg-amber-50/60 text-amber-800' : 'border-blue-500 bg-blue-50/80 text-blue-700'
                        : 'border-slate-200 text-slate-500 hover:border-slate-300',
                    )}
                  >
                    {u === 'admin' && <Shield size={14} />}
                    {u === 'admin' ? 'Administrator' : 'Kasir'}
                  </button>
                ))}
              </div>
            </Polje>
            <button type="submit" hidden />
          </form>

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
            {greska && <span className="mr-auto text-[12px] font-medium text-rose-600">{greska}</span>}
            <Button variant="ghost" onClick={() => setDialog(false)}>Otkaži</Button>
            <Button onClick={spremi} disabled={!ime.trim() || pin.length < 4}
              className="min-w-[100px] bg-[#0f1629] hover:bg-[#1b2540]">
              {uredjuje ? 'Spremi izmjene' : 'Dodaj korisnika'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
