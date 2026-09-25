import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import { PDF_FONT_FAMILY, PDF_FONT_FAMILY_BOLD } from './pdf-fonts';
import { POTPIS_AUTORA } from '@/lib/brend';
import type { FirmaSettings } from '@/types';
import type { KnjigovodjaIzvjestaj } from '@/lib/knjigovodja/obracun';
import { prikazPerioda } from '@/lib/knjigovodja/period';
import { mnozina } from '@/lib/utils';
import { PDV_STOPA_E_PCT } from '@/lib/pdv';

const F = PDF_FONT_FAMILY;
const FB = PDF_FONT_FAMILY_BOLD;
// 1.234,56 — ručno, ne toLocaleString('bs-BA'): Chromium bez punog ICU-a za bs daje 1234.56.
const km = (n: number) => {
  const [cijeli, dec] = Math.abs(n).toFixed(2).split('.');
  const znak = n < 0 && Math.abs(n) >= 0.005 ? '-' : '';
  return `${znak}${cijeli.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
};
const pad = (n: number) => String(n).padStart(2, '0');

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 60, fontFamily: F, fontSize: 9, color: '#000' },
  firma: { fontSize: 11, fontFamily: FB, fontWeight: 700 },
  firmaRed: { fontSize: 8, color: '#333', marginTop: 1 },
  naslov: { fontSize: 13, fontFamily: FB, fontWeight: 700, textAlign: 'center', marginTop: 18 },
  podnaslov: { fontSize: 9, textAlign: 'center', marginTop: 3, marginBottom: 14 },
  sekcija: { marginBottom: 10 },
  sekcijaNaslov: { fontSize: 9, fontFamily: FB, fontWeight: 700, borderBottom: '1pt solid #000', paddingBottom: 2, marginBottom: 3 },
  red: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5, borderBottom: '0.5pt solid #eee' },
  redJak: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2, borderTop: '1pt solid #000', marginTop: 1 },
  vrijednost: { fontFamily: FB, fontWeight: 700 },
  upozorenje: { fontSize: 8, paddingVertical: 1 },
  napomena: { fontSize: 7.5, color: '#444' },
  potpisi: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 32 },
  potpis: { width: '40%', borderTop: '0.5pt solid #000', paddingTop: 3, fontSize: 8, textAlign: 'center' },
  footer: { position: 'absolute', bottom: 22, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 6.5, color: '#999' },
});

function Red({ label, value, jak }: { label: string; value: string; jak?: boolean }) {
  return (
    <View style={jak ? s.redJak : s.red}>
      <Text>{label}</Text>
      <Text style={s.vrijednost}>{value}</Text>
    </View>
  );
}

export interface KnjigovodjaPdfProps {
  izvjestaj: KnjigovodjaIzvjestaj;
  firma: Pick<FirmaSettings, 'naziv' | 'adresa' | 'grad' | 'idBroj' | 'pdvBroj'>;
  izvezeno: Date;
}

export function KnjigovodjaPdf({ izvjestaj: iz, firma, izvezeno }: KnjigovodjaPdfProps) {
  const z = iz.zbir;
  const datumIzvoza = `${pad(izvezeno.getDate())}.${pad(izvezeno.getMonth() + 1)}.${izvezeno.getFullYear()}.`;
  const upozorenja = iz.upozorenja.slice(0, 40);
  return (
    <Document title={`Izvještaj za knjigovodstvo — ${prikazPerioda(iz)}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.firma}>{firma.naziv || '—'}</Text>
        {(firma.adresa || firma.grad) && <Text style={s.firmaRed}>{[firma.adresa, firma.grad].filter(Boolean).join(', ')}</Text>}
        <Text style={s.firmaRed}>{[firma.idBroj && `JIB: ${firma.idBroj}`, firma.pdvBroj && `PDV broj: ${firma.pdvBroj}`].filter(Boolean).join('   ')}</Text>

        <Text style={s.naslov}>IZVJEŠTAJ ZA KNJIGOVODSTVO</Text>
        <Text style={s.podnaslov}>Period: {prikazPerioda(iz)} · Izvezeno: {datumIzvoza}</Text>

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Promet ({z.promet.brojRacuna} {mnozina(z.promet.brojRacuna, ['račun', 'računa', 'računa'])})</Text>
          <Red label={`Osnovica ${PDV_STOPA_E_PCT}%`} value={km(z.promet.osnovicaE)} />
          <Red label={`PDV ${PDV_STOPA_E_PCT}%`} value={km(z.promet.pdvE)} />
          <Red label="Oslobođeno PDV-a (K)" value={km(z.promet.iznosK)} />
          <Red label="Gotovina" value={km(z.promet.gotovina)} />
          <Red label="Kartica" value={km(z.promet.kartica)} />
          <Red label="Virman" value={km(z.promet.virman)} />
          <Red label="Ček" value={km(z.promet.cek)} />
          <Red label="Ukupan promet" value={km(z.promet.ukupno)} jak />
        </View>

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Reklamacije ({z.reklamacije.broj})</Text>
          <Red label={`Osnovica ${PDV_STOPA_E_PCT}%`} value={km(z.reklamacije.osnovicaE)} />
          <Red label={`PDV ${PDV_STOPA_E_PCT}%`} value={km(z.reklamacije.pdvE)} />
          <Red label="Oslobođeno PDV-a (K)" value={km(z.reklamacije.iznosK)} />
          <Red label="Ukupno reklamacije" value={km(z.reklamacije.ukupno)} jak />
          <Red label="Neto promet" value={km(z.neto)} jak />
        </View>

        {iz.moduli.skladiste && (
          <View style={s.sekcija}>
            <Text style={s.sekcijaNaslov}>Ulaz robe ({z.ulaz.brojPrimki} {mnozina(z.ulaz.brojPrimki, ['primka', 'primke', 'primki'])})</Text>
            <Red label="Nabavna vrijednost" value={km(z.ulaz.nabavna)} />
            <Red label="PDV" value={km(z.ulaz.pdv)} />
            <Red label="Prodajna vrijednost" value={km(z.ulaz.prodajna)} />
            <Red label="Nivelacije — ukupna razlika" value={km(z.nivelacijeRazlika)} />
          </View>
        )}

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Gotovina u kasi</Text>
          <Red label="Polog" value={km(z.polozi)} />
          <Red label="Povrat" value={km(z.povrati)} />
        </View>

        {iz.moduli.proizvodnja && (
          <View style={s.sekcija}>
            <Text style={s.sekcijaNaslov}>Utrošak materijala ({z.utrosak.brojNaloga} {mnozina(z.utrosak.brojNaloga, ['nalog', 'naloga', 'naloga'])})</Text>
            <Red label="Nabavna vrijednost utrošenog materijala" value={km(z.utrosak.vrijednost)} />
          </View>
        )}

        {iz.moduli.skladiste && (
          <View style={s.sekcija}>
            <Text style={s.sekcijaNaslov}>Zalihe na dan {iz.do.split('-').reverse().join('.')}.</Text>
            <Red label="Nabavna vrijednost" value={km(z.zalihe.nabavna)} />
            <Red label="Prodajna vrijednost" value={km(z.zalihe.prodajna)} />
          </View>
        )}

        <View style={s.sekcija}>
          <Text style={s.sekcijaNaslov}>Kontrola</Text>
          {upozorenja.length === 0 && <Text style={s.upozorenje}>Nema upozorenja.</Text>}
          {upozorenja.map((u, i) => <Text key={i} style={s.upozorenje}>• {u.opis}</Text>)}
          {iz.upozorenja.length > upozorenja.length && (
            <Text style={s.upozorenje}>… i još {iz.upozorenja.length - upozorenja.length} (vidi list „Kontrola“ u Excelu)</Text>
          )}
        </View>

        {/* Napomena i potpisi prelaze na novu stranu zajedno — potpisi nikad ne ostaju sami. */}
        <View wrap={false}>
          <Text style={s.napomena}>Z i X izvještaji se vode na fiskalnom uređaju i nisu dio ovog izvoza. Detalji su u priloženom Excel fajlu.</Text>
          <View style={s.potpisi}>
            <Text style={s.potpis}>Sastavio</Text>
            <Text style={s.potpis}>Primio</Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{POTPIS_AUTORA}</Text>
          <Text render={({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
