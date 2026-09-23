// src/screens/ProizvodnjaScreen.tsx (privremeno — Task 11 ga zamjenjuje)
export default function ProizvodnjaScreen({ korisnikId, uloga, initialNalogId }: {
  korisnikId: number; uloga: 'admin' | 'kasir'; initialNalogId?: number | null;
}) {
  return (
    <div className="p-6 text-slate-500 text-[13px]">
      Proizvodnja (korisnik {korisnikId}, {uloga}{initialNalogId ? `, nalog #${initialNalogId}` : ''})
    </div>
  );
}
