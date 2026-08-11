# Tring: službeni unos novca (polog) — API i zakonski okvir (FBiH)

Datum istraživanja: 2026-08-11

## TL;DR

- **Tring komanda postoji i zove se `UnosNovca`** (suprotna komanda: `PovratNovca`). Potvrđeno u zvaničnom Tring uputstvu za integraciju (sekcija 7.5; datoteke `unosnovca.xml`/`un.xml`, odnosno `povratnovca.xml`/`pn.xml`). Parametri: vrsta plaćanja (`Gotovina` / `Cek` / `Kartica` / `Virman`, case-sensitive) i iznos. Tačni nazivi XML elemenata i HTTP path nisu potvrđeni iz javno dostupnog teksta (vjerovatno `/un`, vrsta zahtjeva vjerovatno `7`).
- **Zakon FBiH ne propisuje obavezan jutarnji polog**, ali definiše "gotovinu u kasi" tako da uključuje novac koji je **blagajnik unio u kasu** — pa ako se polog fizički stavi u ladicu, mora se evidentirati kroz fiskalni uređaj da bi se stanje slagalo pri inspekciji.
- **Polog se NE pojavljuje na dnevnom (Z) izvještaju** — "STANJE U KASI" blok postoji samo na **presjeku stanja** (X izvještaj), ne i na dnevnom izvještaju. Potvrđeno iz prečišćenog teksta Pravilnika o fiskalnim dokumentima (pufbih.ba).

## 1. Tring API nalazi

### Potvrđeno (primarni izvori)

Postojeća integracija u ovoj aplikaciji (`/Users/tarik/Documents/development/kasa-app/src/services/tring.ts`) koristi Tring.Fiscal.Server HTTP mod: XML preko `POST http://localhost:8085/<adresa>`, s poznatim adresama `/inicijalizacija`, `/ua` (upiši artikal, VrstaZahtjeva=105), `/sfr` (fiskalni račun, VZ=0), `/srr` (reklamirani račun, VZ=2), `/sps` (presjek stanja, VZ=3), `/sdi` (dnevni izvještaj, VZ=4), `/spi` (periodični izvještaj, VZ=5).

Iz zvaničnog Tring dokumenta "Uputstvo za integraciju — Tring fiskalni sistemi" (45 str., yumpu; pregledane sve stranice 5–45):

- **Sekcija 7.5 "Unos i iznos novca — UnosNovca, PovratNovca"** (str. 34–35):
  > "Dozvoljeni načini unosa novca: Gotovina, Cek, Kartica i Virman. Vodite računa o nazivima vrsti uplata jer su 'case sensitive'!"
- Nazivi komandnih datoteka: **`unosnovca.xml` ili `un.xml`** (za `UnosNovca`), **`povratnovca.xml` ili `pn.xml`** (za `PovratNovca`).
- Primjer komande `UnosNovca` — sačuvane samo vrijednosti (Yumpu-ov tekstualni sloj briše sve unutar `<...>`, pa nazivi XML elemenata NISU sačuvani): `0 7 Gotovina 125.35`; odgovor: `OK 553325325`. Primjer za `PovratNovca`: `0 7 Virman 120.33`. Par `0 7` je vjerovatno broj zahtjeva + vrsta zahtjeva **7** (isto za obje komande, razlikuju se po nazivu/adresi) — ali dokument to ne imenuje u čitljivom tekstu i **nigdje ne daje tabelu VrstaZahtjeva kodova**.
- Str. 16: "Primjeri komandi i odgovarajuće XSD šeme su dati u direktoriju: **/xml/primjeri**" (u instalaciji Tring.Fiscal softvera) — tamo su autoritativni nazivi elemenata.
- File-based mod (Tring.Fiscal.Server skenira direktorij, default `C:\Tring\XML`): datoteke se imenuju `NAZIV_KOMANDE.BROJ_ZAHTJEVA`, npr. **`unosnovca.99687`**; odgovori stižu kao XML istog naziva u poddirektorij `/odgovori`.
- HTTP mod (sekcija 6.1.3): adresa komande je naziv komande, npr. `http://localhost:8085/inicijalizacija`, `Content-Type: text/xml`; test dostupnosti na `http://localhost:8085/test`. **Dokument nigdje ne navodi tabelu komanda→URL niti eksplicitno `/un`** — kratki path `/un` je samo analogija s nazivom datoteke `un.xml` (i sa postojećim kratkim adresama `/sfr`, `/sdi`... koje ova aplikacija već uspješno koristi).
- C# biblioteka (Tring Fiscal Library): `printer.UnosNovca(VrstePlacanja.Gotovina, 100);` odnosno funkcije `tfl_cash_in` / `tfl_cash_out`.
- Obavezan scenarij upotrebe (sekcija 7.4, str. 30–31):
  > "Potrebno je imati dovoljan iznos Gotovine u kasi za izdavanje reklamiranog računa. ... Povrat novca od reklamiranog računa je moguć samo u Gotovini."
  > "Recimo da je kupac xx datuma uplatio virmanski 100 KM. Dolazi nakon yy dana da reklamira račun. Potrebno je izvršiti komandu UnosNovca, gotovinski 100 KM. Napraviti reklamirani račun sa gotovinskim povratom 100 KM."
- Presjek stanja (str. 35) štampa "stanje novca u kasi" — na to utiču `UnosNovca`/`PovratNovca`. Dump podataka uređaja (str. 40–41) sadrži brojače `_GotovinaUnos`, `_CekUnos`, `_KarticaUnos`, `_VirmanUnos`, `_StanjeGotovine`.

### Nepotvrđeno / nije pronađeno

- Tačni nazivi XML elemenata zahtjeva za `UnosNovca`/`PovratNovca` (Yumpu briše tagove; ranije viđeni primjeri s `<VrstaZahtjeva>` su rekonstrukcija, ne citat). Autoritativni izvor: XSD šeme u `/xml/primjeri` uz instalaciju Tring.Fiscal softvera.
- Eksplicitna potvrda HTTP patha (`/un`, `/pn`) — najizglednije, ali treba provjeriti protiv pravog Tring.Fiscal.Server-a.
- Scribd kopije dokumentacije nisu čitljive kroz web (samo landing metapodaci).

## 2. Zakonski zahtjevi (FBiH)

### Zakon o fiskalnim sistemima ("Službene novine FBiH" br. 81/09)

Primarni izvor: PDF na fuzip.gov.ba (link u izvorima), tekst provjeren direktno.

- **Član 2 (definicije):**
  > "Gotovina u kasi predstavlja razliku zbira gotovine koju su uplatili klijenti i gotovine koju je u kasu unio blagajnik i zbira gotovine vraćene klijentima i gotovine koju je iz kase iznio blagajnik."

  Dakle, zakon eksplicitno računa s time da blagajnik **unosi** i **iznosi** novac iz kase — to je pravni temelj funkcije "unos novca" (polog) na fiskalnom uređaju.
- **Nigdje u zakonu se ne pominju riječi "polog", "depozit" ni "službeni unos"** — ne postoji izričita obaveza jutarnjeg pologa. Obaveza je posredna: stanje gotovine u ladici mora odgovarati "gotovini u kasi" koju uređaj iskazuje, a u tu vrijednost ulazi samo ono što je evidentirano (prodaje + unosi blagajnika).
- **Član 44:** obveznik je dužan formirati i odštampati **dnevni izvještaj na kraju rada, minimalno jednom dnevno, ukoliko je tog dana ostvario promet**, i odlagati isječke u knjigu dnevnih izvještaja (po jedna knjiga po uređaju po kalendarskoj godini).

### Pravilnik o fiskalnim dokumentima (Sl. novine FBiH 50/20, prečišćeni tekst s pufbih.ba)

Primarni izvor: PDF Porezne uprave FBiH, tekst provjeren direktno.

- **Član 39. (presjek stanja)** — presjek stanja sadrži, među blokovima, tačku k):
  > "bloka sa iznosom gotovine u kasi, vrijednosti čekova u kasi, vrijednosti prometa karticama u kasi i vrijednosti virmana u kasi u izvještajnom periodu"

  Blok se štampa s fiksnim tekstom **"STANJE U KASI:"** i redovima po sredstvu plaćanja (gotovina, čekovi, kartice, virman).
- **Član 40. (dnevni izvještaj)** — nabraja blokove a)–k) dnevnog izvještaja: zaglavlje, brojevi računa, servisiranja, reseti, promjene stopa, stornirani artikli, evidentirani promet/porez po stopama, reklamirani promet/porez, digitalni potpis. **Blok "gotovina u kasi" NIJE među njima.**
- Pravilnik također ne pominje "unos novca", "polog" ni "depozit" — sadržaj tih operacija je stvar funkcionalnosti uređaja, a njihov efekat se vidi isključivo kroz "STANJE U KASI" na presjeku stanja.

### Praksa / tumačenja (sekundarni izvori)

- FAQ Intercomp d.o.o. Visoko (ovlašteni zastupnik fiskalnih uređaja u FBiH):
  > "Ukoliko ste fizički izvršili unos gotovine u vašu kasu, morate to evidentirati i kroz fiskalni uređaj."

  Isti izvor navodi da inspekcija upoređuje fizičko stanje ladice s presjekom stanja, te kaznene odredbe 1.000–30.000 KM za pravna lica.

### Zaključak pravne analize

1. **Polog nije izričita zakonska obaveza** — nijedan propis ne kaže "kasir mora ujutro unijeti X KM".
2. **Ali je praktično obavezan** čim u ladici ima gotovine za vraćanje kusura: definicija "gotovine u kasi" (čl. 2 Zakona) i blok "STANJE U KASI" na presjeku stanja znače da neevidentirani novac u ladici = neslaganje pri kontroli.
3. **Polog se ne vidi na dnevnom (Z) izvještaju** — Z izvještaj iskazuje promet i poreze; stanje gotovine (uključujući pologe) iskazuje samo presjek stanja (X).
4. Dodatno, Tring dokumentacija traži `UnosNovca` prije gotovinske isplate reklamiranog računa ako u kasi nema dovoljno evidentirane gotovine.

## 3. Implikacije za implementaciju u ovoj aplikaciji

- Dodati u `src/services/tring.ts` funkciju `unosNovca(vrstaPlacanja, iznos)` (i po potrebi `povratNovca`) po istom envelope obrascu kao postojeće komande; endpoint i `VrstaZahtjeva` potvrditi (vidi TODO / otvorena pitanja).
- UI tok: na početku smjene ponuditi unos pologa (npr. 50 KM gotovine); prije štampanja reklamiranog računa provjeriti/ponuditi `UnosNovca` ako stanje gotovine nije dovoljno.
- Mock server (`src/services/tring-mock-server.ts`) dopuniti odgovarajućom rutom.
- Polog ne treba prikazivati kao promet — ne ulazi u dnevni izvještaj; eventualno ga prikazati u lokalnoj evidenciji smjene i uputiti korisnika da stanje provjerava presjekom stanja.

## 4. Izvori

Primarni:
- Zakon o fiskalnim sistemima FBiH (Sl. novine FBiH 81/09), PDF: https://fuzip.gov.ba/wp-content/uploads/2022/09/Zakon_o_fiskalnim_sistemima_sl_novine_fbih_broj_81_2009-9.pdf
- Pravilnik o fiskalnim dokumentima, prečišćeni tekst, Porezna uprava FBiH: https://www.pufbih.ba/v1/public/upload/zakoni/82eed-pravilnik-o-fiskalnim-dokumentima-precisceni-tekst.pdf (i verzija 50/20: https://www.pufbih.ba/v1/public/upload/zakoni/3ee89-pravilnik-o-fiskalnim-dokumentima-50-20.pdf)
- Tring d.o.o., "Uputstvo za integraciju — Tring fiskalni sistemi": https://www.yumpu.com/xx/document/view/7741707/uputstvo-za-integraciju-tring-fiskalni-sistemi

Sekundarni:
- Scribd kopije Tring dokumentacije: https://www.scribd.com/document/427204324/tring , https://www.scribd.com/document/427205254/Uputstvo-Za-Tring-Fiscal-Library , https://www.scribd.com/document/611962449/Software-integration-with-Tring-Fiscal
- Intercomp d.o.o. FAQ o fiskalizaciji: https://intercomp.ba/fiskalizacija/pitanjafiskalizacija/
- Advokat Prnjavorac, tekst Zakona: https://advokat-prnjavorac.com/Zakon-o-fiskalnim-sistemima-FBiH.html
- BiH-pravo, tekst Pravilnika: https://www.bih-pravo.org/post4296.html

## 5. Otvorena pitanja

- Tačan HTTP endpoint path za `UnosNovca`/`PovratNovca` na Tring.Fiscal.Server (pretpostavka `/un` i `/pn` po obrascu naziva datoteka `un.xml`/`pn.xml` i ostalih kratkih adresa — NEPOTVRĐENO; provjeriti na pravom uređaju/serveru ili u XSD primjerima u `/xml/primjeri` instalacije).
- Tačni nazivi XML elemenata i vrijednost vrste zahtjeva (primjer sugeriše `7`, ali polje nije imenovano u dostupnom tekstu).
- Da li Tring uređaj štampa poseban (nefiskalni) isječak pri unosu novca.
- Ponašanje pologa pri formiranju dnevnog izvještaja: da li se "stanje u kasi" resetuje Z izvještajem (očekivano da, jer je izvještajni period presjeka "od posljednjeg dnevnog izvještaja").
