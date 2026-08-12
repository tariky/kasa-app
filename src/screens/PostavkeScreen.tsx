import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { User, TringSettings, BankAccount } from '@/types';
import {
  UserPlus, Wifi, WifiOff, Save, Trash2, Pencil,
  Users, Printer, Building2, Shield, Hash, KeyRound,
  MapPin, FileText, Image, CheckCircle2, AlertTriangle,
  HardDrive, Download, Upload, Bug, RefreshCw, X, ChevronDown, ChevronUp, Settings, Landmark, Percent,
} from 'lucide-react';

type SettingsTab = 'korisnici' | 'fiskalni' | 'firma' | 'sistem';

export default function PostavkeScreen() {
  // ── Korisnici state ──
  const [users, setUsers] = useState<User[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formIme, setFormIme] = useState('');
  const [formPin, setFormPin] = useState('');
  const [formUloga, setFormUloga] = useState<'kasir' | 'admin'>('kasir');

  // ── Tring state ──
  const [tringHost, setTringHost] = useState('localhost');
  // Port i operator ID se drže kao tekst da prazno polje ne postane 0.
  const [tringPort, setTringPort] = useState('8085');
  const [tringOperatorId, setTringOperatorId] = useState('0');
  const [tringPassword, setTringPassword] = useState('0');
  const [tringStatus, setTringStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ── Firma state ──
  const [firmaNaziv, setFirmaNaziv] = useState('');
  const [firmaAdresa, setFirmaAdresa] = useState('');
  const [firmaGrad, setFirmaGrad] = useState('');
  const [firmaIdBroj, setFirmaIdBroj] = useState('');
  const [firmaPdvBroj, setFirmaPdvBroj] = useState('');
  const [firmaSkladiste, setFirmaSkladiste] = useState('');
  const [firmaLogo, setFirmaLogo] = useState('');
  const [firmaBankAccounts, setFirmaBankAccounts] = useState<BankAccount[]>([
    { bankName: '', accountNumber: '' },
    { bankName: '', accountNumber: '' },
    { bankName: '', accountNumber: '' },
  ]);
  const [firmaStatus, setFirmaStatus] = useState('');
  const [backupStatus, setBackupStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ── Kasa settings ──
  const [showDailyTotal, setShowDailyTotal] = useState(false);
  const [devLogging, setDevLogging] = useState(false);
  const [allowZeroStock, setAllowZeroStock] = useState(false);
  const [unosBezPdv, setUnosBezPdv] = useState(false);
  // Inline potvrda nakon promjene režima; sama se sakrije nakon 5 s.
  const [pdvPotvrda, setPdvPotvrda] = useState('');
  const [kusurKalkulacija, setKusurKalkulacija] = useState(true);
  const [requirePinRefund, setRequirePinRefund] = useState(false);
  const [generatorEnabled, setGeneratorEnabled] = useState(false);
  const [racunNapomena, setRacunNapomena] = useState('');

  // ── Debug state ──
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<any[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const loadDebugLogs = async () => {
    setDebugLoading(true);
    try {
      const logs = await window.api.tringGetLogs();
      setDebugLogs(logs.reverse());
    } catch { /* ignore */ }
    setDebugLoading(false);
  };

  const clearDebugLogs = async () => {
    await window.api.tringClearLogs();
    setDebugLogs([]);
  };

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<SettingsTab>('korisnici');

  // ── Load users ──
  const loadUsers = async () => {
    const data = await window.api.getUsers();
    setUsers(data);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  // ── Load Kasa settings ──
  useEffect(() => {
    window.api.getSetting('kasa.showDailyTotal').then((v) => setShowDailyTotal(v === 'true'));
    window.api.getSetting('dev.logging').then((v) => setDevLogging(v === 'true'));
    window.api.getSetting('kasa.allowZeroStock').then((v) => setAllowZeroStock(v === 'true'));
    window.api.getSetting('cijene.unosBezPdv').then((v) => setUnosBezPdv(v === 'true'));
    // Kalkulacija kusura je podrazumijevano uključena — isključena samo na eksplicitno 'false'.
    window.api.getSetting('kasa.kusurKalkulacija').then((v) => setKusurKalkulacija(v !== 'false'));
    window.api.getSetting('kasa.requirePinRefund').then((v) => setRequirePinRefund(v === 'true'));
    window.api.getSetting('ui.showGenerator').then((v) => setGeneratorEnabled(v === 'true'));
    window.api.getSetting('racun.napomena').then((v) => setRacunNapomena(v || ''));
  }, []);

  useEffect(() => {
    if (!pdvPotvrda) return;
    const t = setTimeout(() => setPdvPotvrda(''), 5000);
    return () => clearTimeout(t);
  }, [pdvPotvrda]);

  // ── Load Firma settings ──
  useEffect(() => {
    window.api.getFirmaSettings().then((s) => {
      setFirmaNaziv(s.naziv);
      setFirmaAdresa(s.adresa);
      setFirmaGrad(s.grad);
      setFirmaIdBroj(s.idBroj);
      setFirmaPdvBroj(s.pdvBroj);
      setFirmaSkladiste(s.skladiste);
      setFirmaLogo(s.logo);

      const padded: BankAccount[] = [0, 1, 2].map(i =>
        s.bankAccounts[i] ?? { bankName: '', accountNumber: '' }
      );
      setFirmaBankAccounts(padded);
    });
  }, []);

  // ── Load Tring settings ──
  useEffect(() => {
    (async () => {
      try {
        const settings: TringSettings = await window.api.getTringSettings();
        if (settings) {
          setTringHost(settings.host || 'localhost');
          setTringPort(String(settings.port ?? 8085));
          setTringOperatorId(String(settings.operatorId ?? 0));
          setTringPassword(settings.operatorPassword || '0');
        }
      } catch {
        // Use defaults
      }
    })();
  }, []);

  // ── User dialog helpers ──
  const openNewUserDialog = () => {
    setEditingUser(null);
    setFormIme('');
    setFormPin('');
    setFormUloga('kasir');
    setDialogOpen(true);
  };

  const openEditUserDialog = (user: User) => {
    setEditingUser(user);
    setFormIme(user.ime);
    setFormPin(user.pin);
    setFormUloga(user.uloga);
    setDialogOpen(true);
  };

  const handleSaveUser = async () => {
    if (!formIme.trim() || !formPin.trim()) return;

    if (editingUser) {
      await window.api.updateUser(editingUser.id, { ime: formIme, pin: formPin, uloga: formUloga });
    } else {
      await window.api.createUser({ ime: formIme, pin: formPin, uloga: formUloga });
    }

    setDialogOpen(false);
    loadUsers();
  };

  const handleDeleteUser = async (user: User) => {
    const ac = users.filter(u => u.uloga === 'admin').length;
    if (user.uloga === 'admin' && ac <= 1) return;

    await window.api.deleteUser(user.id);
    loadUsers();
  };

  const maskPin = (pin: string) => {
    if (pin.length <= 2) return pin;
    return '\u2022'.repeat(pin.length - 2) + pin.slice(-2);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  };

  // ── Firma handlers ──
  const handleSaveFirma = async () => {
    const cleanedAccounts = firmaBankAccounts
      .map(a => ({ bankName: a.bankName.trim(), accountNumber: a.accountNumber.trim() }))
      .filter(a => a.bankName !== '' || a.accountNumber !== '');
    await window.api.saveFirmaSettings({
      naziv: firmaNaziv, adresa: firmaAdresa, grad: firmaGrad,
      idBroj: firmaIdBroj, pdvBroj: firmaPdvBroj,
      skladiste: firmaSkladiste, logo: firmaLogo,
      bankAccounts: cleanedAccounts,
    });
    setFirmaStatus('Postavke firme spremljene!');
    setTimeout(() => setFirmaStatus(''), 3000);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFirmaLogo(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ── Tring handlers ──
  const handleSaveTring = async () => {
    const port = parseInt(tringPort, 10);
    const operatorId = parseInt(tringOperatorId, 10);

    if (!tringHost.trim()) {
      setTringStatus({ type: 'error', message: 'Host je obavezan.' });
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setTringStatus({ type: 'error', message: 'Port mora biti broj između 1 i 65535.' });
      return;
    }
    if (!Number.isInteger(operatorId) || operatorId < 0) {
      setTringStatus({ type: 'error', message: 'Operator ID mora biti nenegativan broj.' });
      return;
    }

    try {
      await window.api.saveTringSettings({
        host: tringHost.trim(),
        port,
        operatorId,
        operatorPassword: tringPassword,
      });
      setTringStatus({ type: 'success', message: 'Postavke uspješno sačuvane.' });
    } catch (err: any) {
      setTringStatus({ type: 'error', message: err?.message || 'Greška pri čuvanju postavki.' });
    }
  };

  const handleBackup = async () => {
    setBackupStatus(null);
    try {
      const filePath = await window.api.backupDatabase();
      if (filePath) {
        setBackupStatus({ type: 'success', message: `Backup spremljen: ${filePath}` });
        setTimeout(() => setBackupStatus(null), 5000);
      }
    } catch {
      setBackupStatus({ type: 'error', message: 'Greška pri kreiranju backup-a.' });
    }
  };

  const handleTestConnection = async () => {
    setTringStatus(null);
    try {
      const result = await window.api.tringInit();
      if (result?.success) {
        setTringStatus({ type: 'success', message: `Konekcija uspješna. (${result.vrstaOdgovora})` });
      } else {
        const details = result?.odgovori ? Object.entries(result.odgovori).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
        setTringStatus({ type: 'error', message: `Konekcija neuspješna: ${result?.error || result?.vrstaOdgovora || 'Nepoznata greška'}${details ? ` (${details})` : ''}` });
      }
    } catch (err: any) {
      setTringStatus({ type: 'error', message: `Konekcija neuspješna: ${err?.message || 'Provjerite postavke.'}` });
    }
  };

  const adminCount = users.filter(u => u.uloga === 'admin').length;

  const tabs: { id: SettingsTab; label: string; icon: typeof Users }[] = [
    { id: 'korisnici', label: 'Korisnici', icon: Users },
    { id: 'fiskalni', label: 'Fiskalni printer', icon: Printer },
    { id: 'firma', label: 'Firma', icon: Building2 },
    { id: 'sistem', label: 'Sistem', icon: Settings },
  ];

  return (
    <div className="flex flex-col h-full bg-[hsl(220,20%,97%)]">
      {/* ── Top bar with tabs ── */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-4">
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-fit">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                  isActive
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={15} strokeWidth={isActive ? 2 : 1.5} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* ═══ KORISNICI TAB ═══ */}
        {activeTab === 'korisnici' && (
          <div className="flex flex-col h-full">
            {/* Metric cards */}
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Korisnici</span>
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Users size={16} className="text-blue-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {users.length}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">ukupno registrovanih</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Admini</span>
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                      <Shield size={16} className="text-amber-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {adminCount}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">administratora</p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm shadow-slate-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Kasiri</span>
                    <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
                      <KeyRound size={16} className="text-emerald-500" />
                    </div>
                  </div>
                  <p className="text-[22px] font-bold font-mono tracking-tight text-slate-900 leading-none">
                    {users.filter(u => u.uloga === 'kasir').length}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-2">blagajnika</p>
                </div>
              </div>
            </div>

            {/* Table card */}
            <div className="flex-1 min-h-0 px-6 pb-5">
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 h-full flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-slate-700">Korisnici sistema</span>
                    {users.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0 h-5">
                        {users.length}
                      </Badge>
                    )}
                  </div>
                  <Button size="sm" onClick={openNewUserDialog} className="h-8 gap-1.5 text-[12px]">
                    <UserPlus className="h-3.5 w-3.5" />
                    Novi korisnik
                  </Button>
                </div>

                {users.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 select-none">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center mb-3">
                      <Users size={24} className="text-slate-300" />
                    </div>
                    <p className="text-[13px] font-medium text-slate-500">Nema korisnika</p>
                    <p className="text-[12px] text-slate-400 mt-0.5">Dodajte prvog korisnika klikom na dugme iznad</p>
                  </div>
                ) : (
                  <ScrollArea className="flex-1">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-slate-50/80 backdrop-blur-sm">
                        <tr className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                          <th className="text-left pl-5 pr-2 py-2.5">Ime</th>
                          <th className="text-left px-2 py-2.5 w-[100px]">PIN</th>
                          <th className="text-left px-2 py-2.5 w-[100px]">Uloga</th>
                          <th className="text-left px-2 py-2.5 w-[120px]">Kreiran</th>
                          <th className="text-right pr-5 pl-2 py-2.5 w-[120px]" />
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(user => (
                          <tr
                            key={user.id}
                            className="group border-t border-slate-50 transition-colors hover:bg-slate-50/50"
                          >
                            <td className="pl-5 pr-2 py-2.5 text-[12px] font-medium text-slate-700">{user.ime}</td>
                            <td className="px-2 py-2.5 text-[12px] font-mono text-slate-400">
                              {maskPin(user.pin)}
                            </td>
                            <td className="px-2 py-2.5">
                              <span className={cn(
                                'inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5',
                                user.uloga === 'admin'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-100'
                                  : 'bg-slate-50 text-slate-500 border border-slate-100'
                              )}>
                                {user.uloga === 'admin' && <Shield size={10} />}
                                {user.uloga}
                              </span>
                            </td>
                            <td className="px-2 py-2.5 text-[12px] text-slate-400 tabular-nums">
                              {formatDate(user.createdAt)}
                            </td>
                            <td className="pr-5 pl-2 py-2.5 text-right">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs px-2"
                                  onClick={() => openEditUserDialog(user)}
                                >
                                  <Pencil className="h-3 w-3 mr-1" />
                                  Uredi
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                                  onClick={() => handleDeleteUser(user)}
                                  disabled={user.uloga === 'admin' && adminCount <= 1}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollArea>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══ FISKALNI TAB ═══ */}
        {activeTab === 'fiskalni' && (
          <ScrollArea className="h-full">
          <div className="flex flex-col">
            <div className="flex-shrink-0 px-6 pt-5 pb-4">
              <div className="max-w-xl">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  {/* Header */}
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Printer size={20} className="text-blue-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Tring.Fiscal.Server</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Konfiguracija konekcije na fiskalni server</p>
                      </div>
                    </div>
                  </div>

                  {/* Form */}
                  <div className="px-6 py-5 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="tring-host" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Host
                        </Label>
                        <Input
                          id="tring-host"
                          value={tringHost}
                          onChange={e => setTringHost(e.target.value)}
                          className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="tring-port" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Port
                        </Label>
                        <Input
                          id="tring-port"
                          type="number"
                          min={1}
                          max={65535}
                          value={tringPort}
                          onChange={e => setTringPort(e.target.value.replace(/\D/g, ''))}
                          className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="tring-operator" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Operator ID
                        </Label>
                        <Input
                          id="tring-operator"
                          type="number"
                          min={0}
                          value={tringOperatorId}
                          onChange={e => setTringOperatorId(e.target.value.replace(/\D/g, ''))}
                          className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="tring-password" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Lozinka
                        </Label>
                        <Input
                          id="tring-password"
                          value={tringPassword}
                          onChange={e => setTringPassword(e.target.value)}
                          className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                    </div>

                    <Separator className="bg-slate-100" />

                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={handleSaveTring} className="h-8 gap-1.5 text-[12px]">
                        <Save className="h-3.5 w-3.5" />
                        Sačuvaj
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleTestConnection} className="h-8 gap-1.5 text-[12px]">
                        <Wifi className="h-3.5 w-3.5" />
                        Testiraj konekciju
                      </Button>
                    </div>

                    {tringStatus && (
                      <div className={cn(
                        'flex items-center gap-2 rounded-xl px-4 py-3 text-[12px] font-medium',
                        tringStatus.type === 'success'
                          ? 'bg-emerald-50/60 border border-emerald-100 text-emerald-600'
                          : 'bg-red-50/60 border border-red-100 text-red-600',
                      )}>
                        {tringStatus.type === 'success'
                          ? <CheckCircle2 size={14} />
                          : <WifiOff size={14} />
                        }
                        {tringStatus.message}
                      </div>
                    )}

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Tring.Fiscal.Server mora biti pokrenut na navedenom hostu i portu da bi fiskalni printer radio ispravno.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Debug Log Panel ── */}
            {devLogging && <div className="px-6 pb-5">
              <div className="max-w-4xl">
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                          <Bug size={20} className="text-amber-500" />
                        </div>
                        <div>
                          <h3 className="text-[15px] font-semibold text-slate-800">Debug Log</h3>
                          <p className="text-[12px] text-slate-400 mt-0.5">Svi Tring HTTP zahtjevi i odgovori</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadDebugLogs}
                          disabled={debugLoading}
                          className="h-8 gap-1.5 text-[12px]"
                        >
                          <RefreshCw size={13} className={debugLoading ? 'animate-spin' : ''} />
                          Učitaj logove
                        </Button>
                        {debugLogs.length > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={clearDebugLogs}
                            className="h-8 gap-1.5 text-[12px] text-red-500 hover:text-red-600"
                          >
                            <Trash2 size={13} />
                            Očisti
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {debugLogs.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                      <p className="text-[13px] text-slate-400">Nema logova. Kliknite "Učitaj logove" nakon slanja komande Tring serveru.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-50 max-h-[500px] overflow-y-auto">
                      {debugLogs.map((log) => {
                        const isExpanded = expandedLogId === log.id;
                        const isOk = log.parsed?.success;
                        const time = new Date(log.timestamp);
                        const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}:${String(time.getSeconds()).padStart(2, '0')}`;

                        return (
                          <div key={log.id}>
                            <button
                              onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                              className="w-full px-6 py-3 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
                            >
                              <div className={cn(
                                'w-2 h-2 rounded-full flex-shrink-0',
                                isOk ? 'bg-emerald-400' : 'bg-red-400',
                              )} />
                              <span className="text-[11px] font-mono text-slate-400 w-[65px] flex-shrink-0">{timeStr}</span>
                              <span className="text-[12px] font-mono font-semibold text-slate-700 w-[50px] flex-shrink-0">POST</span>
                              <span className="text-[12px] font-mono text-blue-600 flex-shrink-0">{log.path}</span>
                              <span className={cn(
                                'text-[11px] font-mono font-medium ml-auto flex-shrink-0',
                                isOk ? 'text-emerald-500' : 'text-red-500',
                              )}>
                                {log.statusCode ?? '—'} {log.parsed?.vrstaOdgovora}
                              </span>
                              <span className="text-[10px] font-mono text-slate-300 w-[50px] text-right flex-shrink-0">{log.durationMs}ms</span>
                              {isExpanded ? <ChevronUp size={14} className="text-slate-300" /> : <ChevronDown size={14} className="text-slate-300" />}
                            </button>

                            {isExpanded && (
                              <div className="px-6 pb-4 space-y-3">
                                {/* Parsed response */}
                                {log.parsed && (
                                  <div className="space-y-2">
                                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Parsed Response</p>
                                    <div className="bg-slate-50 rounded-lg p-3 space-y-1">
                                      <div className="flex gap-2 text-[11px] font-mono">
                                        <span className="text-slate-400">success:</span>
                                        <span className={isOk ? 'text-emerald-600' : 'text-red-600'}>{String(log.parsed.success)}</span>
                                      </div>
                                      <div className="flex gap-2 text-[11px] font-mono">
                                        <span className="text-slate-400">vrstaOdgovora:</span>
                                        <span className="text-slate-700">{log.parsed.vrstaOdgovora}</span>
                                      </div>
                                      {log.parsed.error && (
                                        <div className="flex gap-2 text-[11px] font-mono">
                                          <span className="text-slate-400">error:</span>
                                          <span className="text-red-600">{log.parsed.error}</span>
                                        </div>
                                      )}
                                      {log.parsed.odgovori && Object.keys(log.parsed.odgovori).length > 0 && (
                                        <div className="mt-1 pt-1 border-t border-slate-200">
                                          <p className="text-[10px] text-slate-400 mb-1">odgovori:</p>
                                          {Object.entries(log.parsed.odgovori).map(([k, v]) => (
                                            <div key={k} className="flex gap-2 text-[11px] font-mono pl-2">
                                              <span className="text-slate-500">{k}:</span>
                                              <span className="text-slate-800">{v as string}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Request XML */}
                                <div>
                                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Request XML</p>
                                  <pre className="bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                                    {log.requestXml}
                                  </pre>
                                </div>

                                {/* Response XML */}
                                <div>
                                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Response XML</p>
                                  <pre className="bg-slate-900 text-amber-300 text-[11px] font-mono p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto">
                                    {log.responseXml || '(empty — no response)'}
                                  </pre>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>}
          </div>
          </ScrollArea>
        )}

        {/* ═══ FIRMA TAB ═══ */}
        {activeTab === 'firma' && (
          <ScrollArea className="h-full">
            <div className="px-6 pt-5 pb-6">
              <div className="max-w-xl space-y-4">

                {/* Logo card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                        <Image size={20} className="text-violet-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Logo firme</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Prikazuje se na PDF računima i dokumentima</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5">
                    <div className="flex items-center gap-5">
                      {firmaLogo ? (
                        <div className="w-20 h-20 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden">
                          <img src={firmaLogo} alt="Logo" className="max-w-full max-h-full object-contain" />
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-slate-50 border border-dashed border-slate-200 flex items-center justify-center">
                          <Image size={24} className="text-slate-300" />
                        </div>
                      )}
                      <div className="flex-1">
                        <Input type="file" accept="image/*" onChange={handleLogoChange} className="text-[12px] h-9 bg-slate-50 border-slate-200" />
                        <p className="text-[11px] text-slate-400 mt-1.5">PNG, JPG ili SVG. Preporučena veličina 200x200px.</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Company info card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Building2 size={20} className="text-blue-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Podaci o firmi</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Osnovni podaci koji se prikazuju na dokumentima</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Naziv firme
                        </Label>
                        <Input
                          value={firmaNaziv}
                          onChange={e => setFirmaNaziv(e.target.value)}
                          placeholder="Moja Firma d.o.o."
                          className="text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Naziv skladišta
                        </Label>
                        <Input
                          value={firmaSkladiste}
                          onChange={e => setFirmaSkladiste(e.target.value)}
                          placeholder="Glavno skladište"
                          className="text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" />
                        Adresa
                      </Label>
                      <Input
                        value={firmaAdresa}
                        onChange={e => setFirmaAdresa(e.target.value)}
                        placeholder="Ulica bb"
                        className="text-[13px] h-9 bg-slate-50 border-slate-200"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        Grad
                      </Label>
                      <Input
                        value={firmaGrad}
                        onChange={e => setFirmaGrad(e.target.value)}
                        placeholder="Sarajevo"
                        className="text-[13px] h-9 bg-slate-50 border-slate-200"
                      />
                    </div>
                  </div>
                </div>

                {/* Fiscal identifiers card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <Hash size={20} className="text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Fiskalni identifikatori</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">ID i PDV brojevi za fiskalne dokumente</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          ID broj
                        </Label>
                        <Input
                          value={firmaIdBroj}
                          onChange={e => setFirmaIdBroj(e.target.value.replace(/\D/g, ''))}
                          placeholder="4200000000000"
                          maxLength={13}
                          inputMode="numeric"
                          className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          PDV broj
                        </Label>
                        <Input
                          value={firmaPdvBroj}
                          onChange={e => setFirmaPdvBroj(e.target.value.replace(/\D/g, ''))}
                          placeholder="200000000000"
                          maxLength={12}
                          inputMode="numeric"
                          className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bank accounts card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                        <Landmark size={20} className="text-amber-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Bankovni računi</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Prikazuju se na računima (do 3 računa)</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    {firmaBankAccounts.map((acc, i) => (
                      <div key={i} className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                          Račun {i + 1}
                        </Label>
                        <div className="grid grid-cols-2 gap-4">
                          <Input
                            value={acc.bankName}
                            onChange={e => setFirmaBankAccounts(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], bankName: e.target.value };
                              return next;
                            })}
                            placeholder="Naziv banke"
                            className="text-[13px] h-9 bg-slate-50 border-slate-200"
                          />
                          <Input
                            value={acc.accountNumber}
                            onChange={e => setFirmaBankAccounts(prev => {
                              const next = [...prev];
                              next[i] = { ...next[i], accountNumber: e.target.value };
                              return next;
                            })}
                            placeholder="Broj računa"
                            className="font-mono text-[13px] h-9 bg-slate-50 border-slate-200"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Save button + status */}
                <div className="flex items-center gap-3">
                  <Button onClick={handleSaveFirma} className="h-9 gap-2 text-[13px]">
                    <Save size={14} />
                    Spremi postavke firme
                  </Button>
                  {firmaStatus && (
                    <div className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600">
                      <CheckCircle2 size={14} />
                      {firmaStatus}
                    </div>
                  )}
                </div>

              </div>
            </div>
          </ScrollArea>
        )}

        {/* ═══ SISTEM TAB ═══ */}
        {activeTab === 'sistem' && (
          <ScrollArea className="h-full">
            <div className="px-6 pt-5 pb-6">
              <div className="max-w-xl space-y-4">

                {/* Kasa settings card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Settings size={20} className="text-blue-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Postavke kase</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Podešavanja za kasa ekran</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Prikaži dnevni promet</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">Prikazuje ukupan promet za danas na kasa ekranu</p>
                      </div>
                      <Switch
                        checked={showDailyTotal}
                        onCheckedChange={async (checked) => {
                          setShowDailyTotal(checked);
                          await window.api.setSetting('kasa.showDailyTotal', String(checked));
                        }}
                      />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Dozvoli prodaju bez zalihe</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">Omogućuje prodaju artikala koji imaju 0 na stanju</p>
                      </div>
                      <Switch
                        checked={allowZeroStock}
                        onCheckedChange={async (checked) => {
                          setAllowZeroStock(checked);
                          await window.api.setSetting('kasa.allowZeroStock', String(checked));
                        }}
                      />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Kalkulacija kusura</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">Nakon štampe gotovinskog računa otvara prozor za izračun kusura</p>
                      </div>
                      <Switch
                        checked={kusurKalkulacija}
                        onCheckedChange={async (checked) => {
                          setKusurKalkulacija(checked);
                          await window.api.setSetting('kasa.kusurKalkulacija', String(checked));
                        }}
                      />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Zahtijevaj PIN za storniranje</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">Traži unos admin PIN-a prije reklamacije računa</p>
                      </div>
                      <Switch
                        checked={requirePinRefund}
                        onCheckedChange={async (checked) => {
                          setRequirePinRefund(checked);
                          await window.api.setSetting('kasa.requirePinRefund', String(checked));
                        }}
                      />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Dev logiranje</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">Bilježi Tring XML zahtjeve i odgovore u memoriju</p>
                      </div>
                      <Switch
                        checked={devLogging}
                        onCheckedChange={async (checked) => {
                          setDevLogging(checked);
                          await window.api.setSetting('dev.logging', String(checked));
                        }}
                      />
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[13px] font-medium text-slate-700">Generator opcija</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">Prikazuje Generator ekran u navigaciji (samo admin)</p>
                      </div>
                      <Switch
                        checked={generatorEnabled}
                        onCheckedChange={async (checked) => {
                          setGeneratorEnabled(checked);
                          await window.api.setSetting('ui.showGenerator', String(checked));
                          // MainLayout drži navigaciju — obavijesti ga bez remounta
                          window.dispatchEvent(new CustomEvent('ui:showGenerator', { detail: checked }));
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Cijene card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                        <Percent size={20} className="text-emerald-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Cijene</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Način unosa cijena u šifarniku</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="pr-4">
                        <p className="text-[13px] font-medium text-slate-700">Cijene se unose bez PDV-a</p>
                        <p className="text-[12px] text-slate-400 mt-0.5">
                          Kod unosa artikla ili usluge upisuješ cijenu bez PDV-a; aplikacija sama dodaje 17 %
                        </p>
                      </div>
                      <Switch
                        checked={unosBezPdv}
                        onCheckedChange={async (checked) => {
                          setUnosBezPdv(checked);
                          await window.api.setSetting('cijene.unosBezPdv', String(checked));
                          setPdvPotvrda(
                            checked
                              ? 'Cijene se od sada unose bez PDV-a. Postojeći artikli nisu promijenjeni.'
                              : 'Cijene se od sada unose sa PDV-om. Postojeći artikli nisu promijenjeni.'
                          );
                        }}
                      />
                    </div>
                    {pdvPotvrda && (
                      <div className="text-[12px] px-3 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 flex items-start gap-2">
                        <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" />
                        {pdvPotvrda}
                      </div>
                    )}
                  </div>
                </div>

                {/* Receipt note card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                        <FileText size={20} className="text-violet-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Napomena na računu</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Tekst koji se štampa na dnu fiskalnog računa</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5 space-y-3">
                    <Input
                      value={racunNapomena}
                      onChange={e => setRacunNapomena(e.target.value)}
                      placeholder="npr. Hvala na posjeti!"
                      maxLength={100}
                      className="text-[13px] h-9 bg-slate-50 border-slate-200"
                    />
                    <Button
                      size="sm"
                      className="h-8 gap-1.5 text-[12px]"
                      onClick={async () => {
                        await window.api.setSetting('racun.napomena', racunNapomena);
                      }}
                    >
                      <Save size={13} />
                      Sačuvaj napomenu
                    </Button>
                  </div>
                </div>

                {/* Database backup card */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm shadow-slate-200/50 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                        <HardDrive size={20} className="text-amber-500" />
                      </div>
                      <div>
                        <h3 className="text-[15px] font-semibold text-slate-800">Backup baze podataka</h3>
                        <p className="text-[12px] text-slate-400 mt-0.5">Kreirajte kopiju baze na odabranu lokaciju</p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-5">
                    <div className="flex items-center gap-3">
                      <Button onClick={handleBackup} variant="outline" className="h-9 gap-2 text-[13px] border-slate-200">
                        <Download size={14} />
                        Kreiraj backup
                      </Button>
                      {backupStatus && (
                        <div className={cn(
                          'flex items-center gap-1.5 text-[12px] font-medium',
                          backupStatus.type === 'success' ? 'text-emerald-600' : 'text-red-500'
                        )}>
                          {backupStatus.type === 'success' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                          {backupStatus.message}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </ScrollArea>
        )}
      </div>

      {/* ── User Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[420px] p-0 gap-0 overflow-hidden">
          <div className="px-6 pt-6 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  editingUser ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
                )}>
                  {editingUser ? <Pencil className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
                </div>
                <div>
                  <DialogTitle className="text-lg">{editingUser ? 'Uredi korisnika' : 'Novi korisnik'}</DialogTitle>
                  <DialogDescription className="text-xs mt-0.5">
                    {editingUser ? 'Izmijenite podatke korisnika' : 'Unesite podatke za novog korisnika'}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <Separator />

          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="user-ime" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Ime
              </Label>
              <Input
                id="user-ime"
                value={formIme}
                onChange={e => setFormIme(e.target.value)}
                placeholder="Ime korisnika"
                className="h-10 text-[14px] bg-slate-50 border-slate-200"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="user-pin" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                PIN
              </Label>
              <Input
                id="user-pin"
                value={formPin}
                onChange={e => setFormPin(e.target.value.replace(/\D/g, ''))}
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                className="font-mono h-10 text-[14px] bg-slate-50 border-slate-200"
                placeholder="Min. 4 cifre"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Uloga
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setFormUloga('kasir')}
                  className={cn(
                    'h-10 rounded-lg border text-sm font-medium transition-all duration-150',
                    formUloga === 'kasir'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-sm shadow-blue-100'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  Kasir
                </button>
                <button
                  type="button"
                  onClick={() => setFormUloga('admin')}
                  className={cn(
                    'h-10 rounded-lg border text-sm font-medium transition-all duration-150 flex items-center justify-center gap-1.5',
                    formUloga === 'admin'
                      ? 'border-amber-500 bg-amber-50 text-amber-700 shadow-sm shadow-amber-100'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  )}
                >
                  <Shield size={14} />
                  Admin
                </button>
              </div>
            </div>
          </div>

          <div className="border-t bg-slate-50/50 px-6 py-4 flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Otkaži
            </Button>
            <Button onClick={handleSaveUser} disabled={!formIme.trim() || formPin.length < 4} className="min-w-[100px]">
              Sačuvaj
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
