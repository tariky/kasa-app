import { useState, useCallback, useEffect } from 'react';
import { User } from '@/types';
import appIcon from '@/assets/icon.png';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shaking, setShaking] = useState(false);

  const handleDigit = (d: string) => {
    if (pin.length < 6) {
      setPin(prev => prev + d);
      setError('');
    }
  };

  const handleDelete = () => setPin(prev => prev.slice(0, -1));

  const handleSubmit = useCallback(async () => {
    if (pin.length < 4) return;
    const user = await window.api.login(pin);
    if (user) {
      setError('');
      onLogin(user);
    } else {
      setError('Pogrešan PIN');
      setShaking(true);
      setTimeout(() => { setShaking(false); setPin(''); }, 500);
    }
  }, [pin, onLogin]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handleDigit(e.key);
      else if (e.key === 'Backspace') handleDelete();
      else if (e.key === 'Enter') handleSubmit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pin, handleSubmit]);

  return (
    <div className="h-screen flex items-center justify-center bg-[#0a0f1c] relative overflow-hidden">
      {/* Background grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(hsl(217 91% 60% / 0.3) 1px, transparent 1px),
                           linear-gradient(90deg, hsl(217 91% 60% / 0.3) 1px, transparent 1px)`,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Glow effect */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px]" />

      <div className="relative z-10 w-80">
        {/* Logo area */}
        <div className="text-center mb-8">
          <img src={appIcon} alt="Pazar" className="w-16 h-16 rounded-2xl mb-4 shadow-lg shadow-blue-500/20 mx-auto" />
          <h1 className="text-2xl font-bold text-white tracking-tight">Pazar</h1>
          <p className="text-sm text-slate-500 mt-1">Unesite PIN za prijavu</p>
        </div>

        {/* PIN dots */}
        <div
          className={`flex justify-center gap-3 mb-6 transition-transform ${shaking ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}
          style={shaking ? { animation: 'shake 0.4s ease-in-out' } : {}}
        >
          {Array.from({ length: Math.max(4, pin.length + (pin.length < 6 ? 1 : 0)) }).map((_, i) => (
            <div
              key={i}
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 ${
                i < pin.length
                  ? 'bg-blue-500 shadow-sm shadow-blue-500/50 scale-110'
                  : 'bg-slate-700/50 border border-slate-600/30'
              }`}
            />
          ))}
        </div>

        {error && (
          <p className="text-center text-sm text-red-400 mb-4 animate-fade-in">{error}</p>
        )}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2">
          {['1','2','3','4','5','6','7','8','9'].map(d => (
            <button
              key={d}
              onClick={() => handleDigit(d)}
              className="h-16 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white text-xl font-mono font-medium
                         hover:bg-slate-700/50 hover:border-slate-600/50 active:scale-95 transition-all duration-150
                         backdrop-blur-sm"
            >
              {d}
            </button>
          ))}
          <button
            onClick={handleDelete}
            className="h-16 rounded-xl bg-slate-800/30 border border-slate-700/30 text-slate-400 text-sm font-medium
                       hover:bg-slate-700/30 hover:text-slate-300 active:scale-95 transition-all duration-150"
          >
            Obriši
          </button>
          <button
            onClick={() => handleDigit('0')}
            className="h-16 rounded-xl bg-slate-800/50 border border-slate-700/50 text-white text-xl font-mono font-medium
                       hover:bg-slate-700/50 hover:border-slate-600/50 active:scale-95 transition-all duration-150
                       backdrop-blur-sm"
          >
            0
          </button>
          <button
            onClick={handleSubmit}
            className="h-16 rounded-xl bg-blue-600 text-white text-sm font-semibold
                       hover:bg-blue-500 active:scale-95 transition-all duration-150
                       shadow-lg shadow-blue-600/20"
          >
            Prijava
          </button>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-8px); }
          50% { transform: translateX(8px); }
          75% { transform: translateX(-4px); }
        }
      `}</style>
    </div>
  );
}
