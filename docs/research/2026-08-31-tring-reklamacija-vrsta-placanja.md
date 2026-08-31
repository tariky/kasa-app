# Tring: vrste plaćanja na reklamiranom računu, UnosNovca/PovratNovca i greška „nedovoljno novca"

Datum istraživanja: 2026-08-31
Uređaj u pogonu: **Tring FP1** (bitno — vidjeti §6, verzije TFS-a)

## TL;DR

- **Omotač je `<VrstePlacanja>` (množina), djeca su `<VrstaPlacanja>`.** Potvrđeno iz zvanične XSD šeme `stampatireklamiraniracun.xsd` koja se isporučuje uz Tring.Fiscal.Server. **Naš `/sfr` je bagovit** — koristi `<VrstaPlacanja>` kao omotač; naš `/srr` (`<VrstePlacanja />`) ima ispravno ime, ali vjerovatno pogrešan sadržaj.
- **Reklamirani račun praktično MORA imati tačno jednu vrstu plaćanja.** TFS ima namjensku grešku **573 `Jedna_vrsta_placanja_sa_iznosom_0_potrebna_za_reklamaciju`** — postoji i u FP1-ovoj verziji TFS 3.4.522 i u 3.5.x. Zvanični primjeri koje Tring isporučuje (`XML primjeri/srr.reklamirani.xml`) šalju `Gotovina` s `Iznos 0`. **Naš prazni `<VrstePlacanja />` je najvjerovatnije uzrok odbijanja.**
- **Citat „Povrat novca od reklamiranog računa je moguć samo u Gotovini" je POTVRĐEN** — sekcija 7.4, tačka c), str. 30 uputstva koje se isporučuje uz TFS 3.4.522 (verzija za FP1). **ALI**: novije uputstvo (v3.0.1, isporučeno uz TFS 3.5.172) je tu tačku **prepisalo** — povrat je moguć i drugim vrstama plaćanja, slanjem **negativnog** iznosa. Vidjeti §2.
- **`UnosNovca` = VrstaZahtjeva 7. `PovratNovca` = VrstaZahtjeva 8** prema isporučenom primjeru `povratnovca.xml` — iako uputstvo u tekstu za obje piše 7. **Naš kod šalje pogrešan XML** (`<Zahtjev>` + `<Parametri>`), treba `<RacunZahtjev>` + `<NoviObjekat><Oznaka>/<Iznos>`.
- **`ERROR_FISCAL_INSUFFICIENT_MONEY = 108`** je kôd **firmvera uređaja** (`error_codes.h` iz linux tring_fiscal_library). TFS istu situaciju vraća kao **535 `Nedovoljno_novca_u_kasi`**. Uslov: stanje **te konkretne vrste plaćanja** u kasi mora biti ≥ iznosa reklamacije.

## 0. Kako su izvori dobavljeni (metod)

Yumpu/Scribd kopije uputstva **nisu upotrebljive za XML** — Yumpu-ov tekstualni sloj briše sve unutar `<...>` (provjereno: str. 29 i 33 dolaze bez ijednog taga), Scribd vraća samo landing metapodatke.

Umjesto toga sam našao **zvanični Tring download indeks**: <https://www.kase.ba/Downloads> (kase.ba je Tringov portal za fiskalne sisteme; footer svih korisničkih uputstava glasi „TRING d.o.o Gračanica"). S njega su preuzeti i lokalno raspakovani:

| Fajl | Sadrži |
|---|---|
| `https://www.kase.ba/Download/7-uputstvo-za-integraciju.pdf` | Uputstvo za integraciju, 45 str., **s XML tagovima** |
| `https://www.kase.ba/Download/23-Tring.Fiscal.Serve-official.zip` | TFS **v3.4.522** (verzija za FP1) + `XML primjeri/` + `XML primjeri/XSD/` + `Programersko_uputstvo_v30.pdf` + `Lista_greSaka.pdf` |
| `https://www.kase.ba/Download/26-Tring.Fiscal.Server-CryptoFU.zip` | TFS **v3.5.172** + `Uputstva/TringFiscalDriverXSDSchemas/` + `Programersko_uputstvo_v3.0.1.pdf` + `Programmers_Manual_v3.0.1.pdf` + `Lista_greSaka_update C.xlsx` |
| `https://www.kase.ba/Download/22-linux-tring-fiscal-library.zip` | `error_codes.h`, `tring_fiscal_library.h`, `Uputstvo_za_tring_fiscal_library.docx` |
| `https://www.kase.ba/Download/14-TringFiscal-v2.zip` | MSI klijenta; u CAB-u kompletan `/xml/primjeri` set (`unosnovca.xml`, `povratnovca.xml`, `stampatireklamiraniracun.xml`, `*.xsd`) |
| `https://www.kase.ba/Download/19-Korisnicko-uputstvo-FP1-V1.pdf` | Korisničko uputstvo **FP1** |
| `https://www.kase.ba/Download/9-KorisnickoUpustvoFavorit.pdf`, `.../27-KorisnickoUpustvoKasa-FK2-FBiH.pdf`, `https://www.betacomm.com.ba/wp-content/uploads/2016/02/Uputstvo-TringOne.pdf` | greške „NEMA GOTOVINE"/„NEDOSTAJE NOVCA", službeni unos novca |

Ovo su dakle **primarni Tring artefakti (XSD, isporučeni primjeri, header biblioteke), ne prepisi.**

---

## 1. Pitanje 1 — smije li reklamacija imati vrstu plaćanja ≠ Gotovina?

### POTVRĐENO: traženi citat postoji, doslovno

`Programersko_uputstvo_v30.pdf` (isporučeno uz TFS **3.4.522**, tj. uz FP1) i `7-uputstvo-za-integraciju.pdf`, **sekcija 7.4 „Reklamacija - StampatiReklamiraniRacun", str. 30**:

> VAŽNO !!! Prilikom izvršavanja komande štampe reklamiranog računa vrijede ista pravila kao i kod fiskalnog računa (vidjeti poglavlje 7.3) kao i dodatna:
> a) Obavezno je postaviti osobinu „BrojRacuna“ na broj fiskalnog računa na koji se odnosi reklamacija, u komandi za štampu reklamiranoga.
> b) Potrebno je imati dovoljan iznos Gotovine u kasi za izdavanje reklamiranog računa. Ako je npr. Iznos reklamiranog računa 100KM, onda je potrebno imati najmanje 100KM Gotovine u kasi.
> **c) Povrat novca od reklamiranog računa je moguć samo u Gotovini.**
> d) Ako u komandi postoje Vrste plaćanja, onda se ona tretiraju kao doplate od strane kupca !
> Npr. Ako je iznos reklamiranog računa 100KM, a u komandi StampatiReklamiraniRacun postoje vrste plaćanja, npr. Gotovina 10KM, Virman 10KM, onda se podrazumjeva da je kupac doplatio 10KM u gotovini i 10 KM virmanom, pa mu je potrebno vratiti 120KM. Više o ovome možete naći u pravilniku o izgledu fiskalnih dokumenata.

Str. 31, odmah ispod (ovo je „iznimka za virmanski originalni račun" iz pitanja — **ne** postoji iznimka, postoji zaobilaznica):

> Gornji problem možete riješiti na sljedeći način:
> Recimo da je kupca xx datuma uplatio virmanski 100 KM. Dolazi nakon yy dana da reklamira račun. Potrebno je izvšiti komandu UnosNovca, gotovinski 100KM. Napraviti reklamirani račun sa gotovinskim povratom 100KM.
> Doplate nisu implementirane u TringFavourite Plus.

(Zadnja rečenica postoji samo u starijem PDF-u; u v3.0.1 je izbrisana.)

### POTVRĐENO: novije uputstvo je tačku c) PREPISALO — nije više „samo gotovina"

`Programersko_uputstvo_v3.0.1.pdf` (isporučeno uz TFS **3.5.172**), ista sekcija 7.4, str. 30 — tačke a), b), d) su identične, a c) glasi:

> **c) Povrat novca od reklamiranog računa je moguć gotovinom ali ostalim vrstama plaćanja s tim što se za gotovinu šalje iznos „0“ dok za ostale vrste plaćanja treba poslati negativnu vrijednost za isnos reklamiranog računa s tim da stanje te vrste plaćanja u kasi mora bit jednako ili veće od iznosa reklamiranog računa.**

(gramatika i tipfeleri su Tringovi; citirano doslovno)

I novi primjer koji uz to ide, str. 32, naslovljen „Primejr reklamacie virmana" (sic):

```xml
<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
   <BrojZahtjeva>19</BrojZahtjeva>
   <VrstaZahtjeva>2</VrstaZahtjeva>
   <NoviObjekat>
     <StavkeRacuna> ... </StavkeRacuna>
     <VrstaPlacanja>
         <Oznaka>Virman</Oznaka>
         <Iznos>-10.33</Iznos><!--Negativna vrijednost računa za
reklamiranje po ostalim vrstama plaćanja-->
       </VrstaPlacanja>
     </VrstePlacanja>
     <Napomena>Hvala na posjeti !!!</Napomena>
     <BrojRacuna>20</BrojRacuna><!--Broj fiskalnog računa koji se reklamira-->
   </NoviObjekat>
</RacunZahtjev>
```

⚠️ U tom primjeru **nedostaje otvarajući `<VrstePlacanja>`** (zatvarajući postoji) — očigledan tipfeler u dokumentu. Varijanta „sa kupcem" na str. 34 istog dokumenta je ispravna i potvrđuje strukturu:

```xml
    <VrstePlacanja>
    <VrstaPlacanja>
       <Oznaka>Virman</Oznaka>
       <Iznos>-10.33</Iznos><!--Negativna vrijednost računa za reklamiranje
po ostalim vrstama plaćanja-->
      </VrstaPlacanja>
    </VrstePlacanja>
```

### Odgovor

- **Za gotovinski povrat**: pošalji `Gotovina` s **`Iznos 0`**.
- **Za povrat po drugoj vrsti plaćanja (Virman/Kartica/Cek)**: pošalji tu oznaku s **negativnim** iznosom jednakim iznosu reklamacije, i uređaj traži da stanje **te vrste plaćanja** u kasi bude ≥ iznosa reklamacije. **Dokumentovano tek u v3.0.1 uputstvu; za FP1 na TFS 3.4.522 NEPOTVRĐENO da radi** (vidjeti §6).
- **Pozitivan iznos na reklamaciji NIJE povrat** — to je doplata kupca i povećava iznos koji se vraća. Ovo je jedini semantički smisao pozitivnih vrijednosti, u obje verzije uputstva.

### Potvrda na nivou uređaja (FP1)

`19-Korisnicko-uputstvo-FP1-V1.pdf`, sekcija 3.6.2 „REKLAMIRANI FISKALNI RAČUN", str. 16:

> Reklamirani račun ima skoro isti izgled kao i fiskalni račun s tim da se kod reklamiranog računa još pojavljuje jedna linija u zaglavlju, a to je RF (broj računa koji se reklamira). **Iznos reklamiranog računa je uvijek u gotovini.** Da bih se štampao reklamirani račun potrebno je da u FP postoji dovoljna količina gotovine za povrat kupcu.

Isti dokument, sekcija 8.2 „IZDAVANJE REKLAMIRANOG RAČUNA", korak 18, str. 25:

> 18.) **Vrstu plaćanja ostavljamo na gotovina 0,00 ukoliko nema doplate.**

To je Tringova vlastita POS aplikacija (Tring.Pos) na FP1 — i ona šalje `Gotovina` s iznosom `0`, ne prazan element.

---

## 2. Pitanje 2 — tačni nazivi XML elemenata u `RacunZahtjev` (VrstaZahtjeva=2)

### POTVRĐENO — XSD šema, doslovno

`TringFiscalDriverXSDSchemas/stampatireklamiraniracun.xsd` (iz TFS 3.5.172; bajt-identičan onom iz TFS 3.4.522 i onom u MSI-ju iz 2011):

```xml
<xs:element name="VrstePlacanja" minOccurs="0" maxOccurs="unbounded">
  <xs:complexType>
    <xs:sequence>
      <xs:element name="VrstaPlacanja" minOccurs="0" maxOccurs="unbounded">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="Oznaka" type="xs:string" minOccurs="0" />
            <xs:element name="Iznos" type="xs:string" minOccurs="0" />
          </xs:sequence>
        </xs:complexType>
      </xs:element>
    </xs:sequence>
  </xs:complexType>
</xs:element>
```

Puna struktura `NoviObjekat` po XSD-u (redoslijed kako stoji u šemi): `Datum`, `BrojRacuna`, `Kupac{IDbroj,Naziv,Adresa,PostanskiBroj,Grad}`, `StavkeRacuna{RacunStavka{Kolicina,Rabat,artikal{Sifra,Naziv,JM,Cijena,Stopa}}}`, `VrstePlacanja{VrstaPlacanja{Oznaka,Iznos}}`. **Svi elementi su `minOccurs="0"`** (šema je auto-generisani DataSet XSD, potpuno labava) — dakle XSD *sam po sebi* ne zabranjuje prazan `<VrstePlacanja/>`. Validacija koja to odbija je u TFS-u/firmveru, ne u šemi.

`vrstaplacanja.xsd` (stroža, ručno pisana šema iz istog direktorija) daje enumeraciju:

```xml
<xs:complexType name="VrstaPlacanja">
  <xs:sequence>
    <xs:element minOccurs="1" maxOccurs="1" name="Oznaka" type="VrstePlacanja" />
    <xs:element minOccurs="1" maxOccurs="1" name="Iznos" type="xs:double" />
  </xs:sequence>
</xs:complexType>
<xs:simpleType name="VrstePlacanja">
  <xs:restriction base="xs:string">
    <xs:enumeration value="Gotovina" />
    <xs:enumeration value="Cek" />
    <xs:enumeration value="Kartica" />
    <xs:enumeration value="Virman" />
  </xs:restriction>
</xs:simpleType>
```

Tj. **`Cek` bez kvačice, case-sensitive**, i unutar `<VrstaPlacanja>` su `Oznaka` i `Iznos` **obavezni** (`minOccurs="1"`).

### POTVRĐENO — isporučeni primjeri (`/xml/primjeri`)

`XML primjeri/srr.reklamirani.xml` iz **TFS 3.4.522** (verzija za FP1), doslovno:

```xml
<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <VrstaZahtjeva>0</VrstaZahtjeva>
  <NoviObjekat>
    <StavkeRacuna>
      <RacunStavka>
        <artikal>
          <Sifra>1000</Sifra>
          <Naziv>Test artikal</Naziv>
          <JM>ko</JM>
          <Cijena>0.50</Cijena>
          <Stopa>E</Stopa>
          <Grupa>0</Grupa>
          <PLU>0</PLU>
        </artikal>
        <Kolicina>1</Kolicina>
        <Rabat>0</Rabat>
      </RacunStavka>
    </StavkeRacuna>
    <VrstePlacanja>
	<VrstaPlacanja>
        <Oznaka>Gotovina</Oznaka>
        <Iznos>0</Iznos>
      </VrstaPlacanja>
    </VrstePlacanja>
    <BrojRacuna>1</BrojRacuna>
  </NoviObjekat>
</RacunZahtjev>
```

(`<VrstaZahtjeva>0</VrstaZahtjeva>` u ovom fajlu je **Tringov copy-paste bug** — fajl se zove `srr.reklamirani.xml`, ima `BrojRacuna`, a tekst uputstva i sve druge kopije primjera daju `2`. Ne kopirati tu vrijednost.)

`stampatireklamiraniracun.xml` iz `/xml/primjeri` klijentskog paketa (2011) — isto, `Gotovina`/`0`:

```xml
...<VrstePlacanja><VrstaPlacanja><Oznaka>Gotovina</Oznaka><Iznos>0</Iznos></VrstaPlacanja></VrstePlacanja><BrojRacuna>35</BrojRacuna>...
```

### NEPOTVRĐENO / kontradikcija u izvorima

Primjeri **u tijelu uputstva** (sekcije 7.4.1 i 7.4.2, str. 32 i 34 starijeg, str. 31 i 33 v3.0.1) daju **`<VrstePlacanja />`** — prazan element, tačno kao naš kod. Dakle:

- Uputstvo (tekst): `<VrstePlacanja />`
- Fajlovi koje Tring stvarno isporučuje uz server + Tringova vlastita POS aplikacija: `Gotovina` / `0`
- TFS ima grešku 573 „Jedna vrsta placanja sa iznosom 0 potrebna za reklamaciju"

**Zaključak: prazan element je zastarjeli/pogrešan primjer iz teksta uputstva.** Ispravno je jedna `VrstaPlacanja` s `Gotovina`/`0`.

### Šta uređaj radi ako je element prazan/izostavljen

**NEPOTVRĐENO direktnim testom**, ali jaka indirektna potvrda: TFS ima namjensku grešku **573 `Jedna_vrsta_placanja_sa_iznosom_0_potrebna_za_reklamaciju`** (vidjeti §4) — postoji u listi grešaka **i za TFS 3.4.522 (FP1) i za 3.5.x**. Takva greška ne bi postojala da prazan `VrstePlacanja` prolazi.

### BUG u našem kodu: `/sfr` koristi pogrešan omotač

`src/services/tring.ts`, `stampatiFiskalniRacun` gradi:

```
`<VrstaPlacanja>${placanjaXml}</VrstaPlacanja>`
```

gdje je `placanjaXml` niz `<VrstaPlacanja>…</VrstaPlacanja>`. Rezultat je `<VrstaPlacanja><VrstaPlacanja>…</VrstaPlacanja></VrstaPlacanja>`. Zvanični `stampatifiskalniracun.xml` (iz `/xml/primjeri`) i uputstvo, str. 29:

```xml
    <VrstePlacanja>
      <VrstaPlacanja>
        <Oznaka>Gotovina</Oznaka>
        <Iznos>0</Iznos>
      </VrstaPlacanja>
    </VrstePlacanja>
```

Isporučeni primjer s više vrsta plaćanja (potvrđuje ponavljanje `VrstaPlacanja` unutar jednog `VrstePlacanja`):

```xml
<VrstePlacanja><VrstaPlacanja><Oznaka>Gotovina</Oznaka><Iznos>1500</Iznos></VrstaPlacanja><VrstaPlacanja><Oznaka>Virman</Oznaka><Iznos>2000</Iznos></VrstaPlacanja><VrstaPlacanja><Oznaka>Cek</Oznaka><Iznos>3000</Iznos></VrstaPlacanja><VrstaPlacanja><Oznaka>Kartica</Oznaka><Iznos>0</Iznos></VrstaPlacanja></VrstePlacanja>
```

Semantika `Iznos 0` na **fiskalnom** računu (uputstvo str. 28, komentar u C# primjeru):

> //kada je iznos 0 to znači kompletan iznos ide za tu vrstu

Ako naš `/sfr` trenutno radi, radi ili zato što TFS-ov deserializator ignoriše nepoznat omotač i pada na default (`Gotovina` puni iznos), ili zato što je tolerantan. **Treba popraviti bez obzira.**

---

## 3. Pitanje 3 — `UnosNovca` / `PovratNovca`

### POTVRĐENO — XML (uputstvo v3.0.1, sekcija 7.5, str. 36–37; identično u starijem, str. 34–35)

> 7.5. Unos i iznos novca – UnosNovca, PovratNovca
> Dozvoljeni načini unosa novca: Gotovina, Cek, Kartica i Virman. Vodite računa o nazivima vrsti uplata jer su „case sensitive“ !

**UnosNovca** — „Naziv komande datoteke: unosnovca.xml ili un.xml":

```xml
<?xml version="1.0" encoding="utf-8"?>
<RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <BrojZahtjeva>0</BrojZahtjeva>
  <VrstaZahtjeva>7</VrstaZahtjeva>
  <NoviObjekat>
    <Oznaka>Gotovina</Oznaka>
    <Iznos>125.35</Iznos>
  </NoviObjekat>
</RacunZahtjev>
```

**PovratNovca** — „Naziv komande datoteke: povratnovca.xml ili pn.xml": identično, s `<Oznaka>Virman</Oznaka><Iznos>120.33</Iznos>`.

Odgovor u oba slučaja: `<KasaOdgovor …><Odgovori /><VrstaOdgovora>OK</VrstaOdgovora><BrojZahtjeva>…</BrojZahtjeva></KasaOdgovor>`.

XSD (`unosnovca.xsd` / `povratnovca.xsd`, bajt-identični):

```xml
<xs:element name="NoviObjekat" minOccurs="0" maxOccurs="unbounded">
  <xs:complexType>
    <xs:sequence>
      <xs:element name="Oznaka" type="xs:string" minOccurs="0" />
      <xs:element name="Iznos" type="xs:string" minOccurs="0" />
    </xs:sequence>
  </xs:complexType>
</xs:element>
```

**Korijenski element je `RacunZahtjev`, ne `Zahtjev`. Nema `<Parametri>`.** Naš `novacXml()` u `src/services/tring.ts` je potpuno pogrešnog oblika.

### POTVRĐENO — `PovratNovca` je VrstaZahtjeva **8**, ne 7

Isporučeni `/xml/primjeri/povratnovca.xml` (iz MSI-ja klijentskog paketa), doslovno:

```xml
<?xml version="1.0" encoding="utf-8"?><RacunZahtjev xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><BrojZahtjeva>0</BrojZahtjeva><VrstaZahtjeva>8</VrstaZahtjeva><NoviObjekat><Oznaka>Virman</Oznaka><Iznos>100</Iznos></NoviObjekat></RacunZahtjev>
```

a `unosnovca.xml` iz istog seta:

```xml
...<VrstaZahtjeva>7</VrstaZahtjeva><NoviObjekat><Oznaka>Gotovina</Oznaka><Iznos>1500</Iznos></NoviObjekat>...
```

Tekst uputstva za obje komande piše `7`. **Kontradikcija.** Isporučeni fajl je vjerodostojniji (generisan iz koda), ali ostaje rizik. Ako TFS ruta po nazivu komande (adresi), a ne po `VrstaZahtjeva`, razlika možda i nije bitna — to treba testirati na uređaju.

Puna tablica `VrstaZahtjeva` rekonstruisana iz isporučenih primjera (svi provjereni doslovno):

| VZ | Komanda | Korijen | Tijelo |
|---|---|---|---|
| 0 | StampatiFiskalniRacun | `RacunZahtjev` | `NoviObjekat` |
| 1 | NapustiFiskalniPrinter | `Zahtjev` | `Parametri /` |
| 2 | StampatiReklamiraniRacun | `RacunZahtjev` | `NoviObjekat` |
| 3 | StampatiPresjekStanja | `Zahtjev` | `Parametri /` |
| 4 | StampatiDnevniIzvjestaj | `Zahtjev` | `Parametri /` |
| 5 | StampatiPeriodicniIzvjestaj | `Zahtjev` | `Parametri{odDatuma,doDatuma}` |
| 6 | StampatiNefiskalniDokument / duplikati | `Zahtjev` | `Parametri{Text}` |
| **7** | **UnosNovca** | `RacunZahtjev` | `NoviObjekat{Oznaka,Iznos}` |
| **8** | **PovratNovca** | `RacunZahtjev` | `NoviObjekat{Oznaka,Iznos}` |
| 9 | PrekiniRacun | `Zahtjev` | `Parametri /` |
| 105 | UpisiArtikal | `RacunZahtjev` | `NoviObjekat` (artikal) |

### NEPOTVRĐENO — HTTP path `/un` i `/pn`

Uputstvo, sekcija 6.1.3 „METOD DIREKTNOG SLANJA XML NAREDBE PUTEM „HTTP-POST“ METODE", str. 14:

> Npr. **Adresa komande: http://localhost:8085/inicijalizacija**
> Tip podatka: „text/xml“

Dakle **dokumentovan je puni naziv komande kao path**. Kratke adrese (`/sfr`, `/srr`, `/sps`, `/sdi`, `/ua`) nigdje nisu tabelirane u uputstvu — one dolaze iz konvencije imenovanja **datoteka** („`StampatiReklamiraniRacun.xml` ili `srr.xml`", „`unosnovca.xml` ili `un.xml`"), a naša aplikacija ih empirijski koristi uspješno. Pretraga stringova u `Tring.Fiscal.Driver.dll` nije našla nijedan literal kratkog patha (samo `/CitajArtikal`, `/CitajArtikle`, `/IznosRacuna`, `/ResetujArtikle`, `/SljedeciPLU`, `/ValidirajArtikle`) — dispatch se očito radi po nazivu, nije tabela literala.

→ **Preporuka: za nove komande koristiti `/unosnovca` i `/povratnovca` (dokumentovana forma), a `/un`/`/pn` po potrebi kao fallback.**

### Semantika na uređaju

`27-KorisnickoUpustvoKasa-FK2-FBiH.pdf`, sekcija 8.1.9 „SLUŽBENI DEPOZIT UNOS ILI IZNOS GOTOVINE U KASU", str. 35:

> Unoss ili iznos službenog depozita u kasu moguće je iz menija prodaja. Sa funkcijskim tipkama -% i +%.
> Nakon potvrde izbora i unosa gotovine koji želimo dodati ili oduzeti iz kase, **štampaju se nefiskalni dokumenti** potvrde unosa ili iznosa i trenutnog stanja službenog depozita u kasi iz operativne memorije.

`9-KorisnickoUpustvoFavorit.pdf`, 8.11 „SLUŽBENI UNOS ILI IZVOD NOVACA", str. 44:

> kasa POSTAVLJA pitanje o vrsti plaćanja, po kojoj sumi da unese ili izvede unijetu sumu: PLAĆ.(ZBIR, 1-4). … ako vršite službeni izvod novca, **kasa vam to neće dozvoliti ako ne postoji unos za ovu vrstu plaćanja**

Isječak je nefiskalni, glasi `UNIJETO: GOTOVINA: 100,00` odnosno `IZVEDENO: GOTOVINA: 100,00`.

Na nivou C biblioteke (`tring_fiscal_library.h`) `tfl_cash_in`/`tfl_cash_out` **nemaju** parametar vrste plaćanja — samo iznos:

```c
ERROR_CODE tfl_cash_in(uint8_t *comport, uint32_t amount, tfl_RESPONSE_CASH *response);
ERROR_CODE tfl_cash_out(uint8_t *comport, uint32_t amount, tfl_RESPONSE_CASH *response);
```

a odgovor nosi stanje:

```c
typedef struct { uint8_t exit_code; uint32_t cash_sum; uint32_t serv_in; uint32_t serv_out; } tfl_RESPONSE_CASH;
```

---

## 4. Pitanje 4 — `ERROR_FISCAL_INSUFFICIENT_MONEY`

### POTVRĐENO — kôd 108, firmver uređaja

`linux_tring_fiscal_library/error_codes.h`, grupa „Fiscal Errors Group 100", doslovno:

```c
	ERROR_FISCAL_OPERATION_NOT_ALLOWED		= 106,
	ERROR_FISCAL_CANNOT_DELETE_CASHIER_1	= 107,
	ERROR_FISCAL_INSUFFICIENT_MONEY			= 108,
	ERROR_FISCAL_INVALID_TAX_VALUE			= 109,
```

Isti kôd je i u zvaničnoj listi grešaka koju Tring isporučuje uz TFS — kolona **„LISTA GREŠAKA SA FISKALNOG UREĐAJA (NA DISPLEJU FU)"**, red: `ERROR_FISCAL_INSUFFICIENT_MONEY | 108`. Kolona „Opis problema/rješenja" je za taj red **prazna** — Tring nije dao opis.

Web-pretraga tačnog stringa `"ERROR_FISCAL_INSUFFICIENT_MONEY"` **ne vraća nijedan relevantan pogodak** — kôd nije javno indeksiran nigdje osim u ovom headeru.

### POTVRĐENO — TFS ekvivalent je 535, i postoji namjenska greška 573

Ista tabela, kolona **„LISTA GREŠAKA KOJE VRAĆA TFS"**:

| Kôd | Naziv |
|---|---|
| 516 | `Prekoracenje_stavki_racuna_ili_reklamacije` |
| 517 | `Prekoracenje_u_iznosu_reklamacije` |
| 518 | `Ne_postoji_artikal_za_reklamaciju_Problem_rabata_Greska_u_nefiskalnom_tekstu` |
| 521 | `Prekoracenje_iznosa_placanja` |
| 522 | `Pogresna_vrsta_placanja_Servis_u_toku_Nedozvoljeni_rezim` |
| 523 | `Placanja_karticom_ili_cekom_vece_od_iznosa_racuna` |
| 524 | `Ukupna_suma_placanja_veca_od_sume_racuna` |
| **535** | **`Nedovoljno_novca_u_kasi`** |
| **573** | **`Jedna_vrsta_placanja_sa_iznosom_0_potrebna_za_reklamaciju`** |

Obje verzije liste (`Lista_greSaka.pdf` uz TFS **3.4.522** — verzija za FP1 — i `Lista_greSaka_update C.xlsx` uz TFS 3.5.172) sadrže **i 535 i 573**. Format greške je `greska.xsd`: `<Greska><Broj>int</Broj><Opis>string</Opis></Greska>`.

### Koji uslov je uređaj provjerio

**POTVRĐENO** iz korisničkih uputstava — provjerava se **stanje konkretne vrste novca u kasi**, ne samo ukupna gotovina.

`9-KorisnickoUpustvoFavorit.pdf`, 8.7 „REKLAMIRANI RAČUN", str. 41:

> Ako u toku izdavanja reklamacionog računa kasa prijavi grešku tipa ''NEMA GOTOVINE'' ili ''NEDOSTAJE NOVCA'' , znači da **nema dovoljno određene vrste novca u kasi** da bi se račun završio. Zatvorite račun, napravite službeni unos novca, a zatim izdajte novi reklamacioni račun za isti maloprodajni račun sa preostalim stavkama. Ako ste otvorili reklamacioni račun ali u kasi nema novaca ni za jednu stavku, izađite iz reklamacije sa <SMN><BR>. U slučaju da niste izašli iz reklamacionog računa (kada nema dovoljno novca) **kasa će prekinuti reklamacioni račun i otpočeti fiskalni račun.**

`Uputstvo-TringOne.pdf`, 8.3, str. 35:

> Ako u toku izdavanja reklamiranog računa kasa prijavi grešku tipa „NEDOVOLJNO NOVCA'' , znači da nema dovoljno gotovine u kasi da bi se račun završio. Zatvorite račun (ukupan storno), napravite službeni unos novca, a zatim izdajte novi reklamacioni račun za isti maloprodajni račun sa preostalim stavkama.

Da uređaj vodi stanje **po svakoj od četiri vrste plaćanja** potvrđuje i FP1 uputstvo, str. 35, uz opis greške „Napravite_dnevni_izvjestaj":

> … ako su **iznosi novca u kasi po bilo kojoj od četiri vrste plaćanja** dostigli maksimalnu vrijednost* … (* - maksimalna vrijednost iznosi 42.949.672,95 KM)

To se slaže s novom tačkom c) v3.0.1 uputstva („stanje te vrste plaćanja u kasi mora bit jednako ili veće od iznosa reklamiranog računa") i s pravilom da `PovratNovca` neće proći ako nema unosa za tu vrstu plaćanja.

### Zaključak za pitanje 4

`ERROR_FISCAL_INSUFFICIENT_MONEY` (108, firmver) ≈ TFS 535 `Nedovoljno_novca_u_kasi`: **uređaj je uporedio stanje tražene vrste plaćanja u kasi s iznosom koji treba isplatiti i našao da je manje.** Lista `ERROR_FISCAL_*` kodova **jeste dokumentovana** — u `error_codes.h` i u `Lista_greSaka*.pdf/xlsx` uz TFS — ali te datoteke nisu na webu indeksirane; dobavljaju se samo iz Tringovih ZIP paketa (linkovi u §0).

---

## 5. Pitanje 5 — javne implementacije

**NEPOTVRĐENO / nije pronađeno.** Pretražio sam GitHub, npm/packagist upite, i BiH/HR forume:

- **Nema nijednog javnog GitHub/GitLab repozitorija Tring integracije.** GitHub topic `fiskalizacija` sadrži isključivo hrvatske CIS/FINA projekte (`nticaric/fiskalizacija`, `tgrospic/Cis.Fiscalization`, `senko/fiskal-hr`, `ne-znam/woocommerce-racuni-fiskalizacija`) — potpuno drugačiji protokol (SOAP prema Poreznoj upravi RH), bez veze s Tringom.
- Scribd kopije (`427204324/tring`, `611962449/Software-integration-with-Tring-Fiscal`, `696926115/Programmers-Manual-v3-0-1`, `427205254/Uputstvo-Za-Tring-Fiscal-Library`) su skenovi istih Tringovih dokumenata; **tijelo dokumenta nije čitljivo kroz web** (WebFetch vraća samo landing metapodatke). Nisu potrebne — originali su na kase.ba.
- `ipos.hr` „Fiskalizacija u BiH" opisuje **Tremol T260F**, ne Tring; koristi drugačiji, direktorijski XML protokol (`BF`/`RF`/`RBF` polja). Korisno samo kao potvrda poslovnog pravila (uplata u blagajnu prije reklamacije negotovinskog računa), **ne kao izvor za Tring elemente**.

**Zamjena za „javni kod": Tringov vlastiti C# primjer** `https://www.kase.ba/Download/6-cs-primjer.zip` (`Tring.Fiscal.Primjer`, uz `Tring.Fiscal.Driver.dll`). Relevantni isječak iz uputstva, str. 28 (isti kod je u ZIP-u):

```csharp
//unijeti način plaćanja
//kada je iznos 0 to znači kompletan iznos ide za tu vrstu
//prema Zakonu, mora se omogućiti da jedan račun bude plaćen na više vrsta plaćanja
//npr. ako je iznos računa 110 KM, treba omogućiti da 100 bude plaćano Karticom a 10 u Gotovini
_racun.DodajVrstuPlacanja(VrstePlacanja.Virman, 0);
//dodati u printer
if (fiskalniracun) {
    odgovor = printer.StampatiFiskalniRacun(_racun);
} else {
    odgovor = printer.StampatiReklamiraniRacun(_racun);
}
```

Ključno: **isti `Racun` objekt s istim `VrstePlacanja` ide i u fiskalni i u reklamirani račun** — driver ne prazni listu plaćanja za reklamaciju. Isto vrijedi na C nivou (`tring_fiscal_library.h`), gdje jedna funkcija radi oboje:

```c
ERROR_CODE tfl_receipt(uint8_t *comport, uint8_t *iosa, tfl_CASHIER *cashier, uint32_t reclaimed,
                       tfl_RECEIPT_ITEM receipt_items[], uint16_t receipt_items_count,
                       tfl_PAYMENTS payments[], uint16_t payments_count,
                       tfl_CUSTOMER *customer, uint8_t *note, tfl_RESPONSE_RECEIPT *response);
```

s dokumentacijom (`Uputstvo_za_tring_fiscal_library.docx`): `reclaimed` = „Broj reklamiranog računa (0 za fiskalni račun)", `*payments` = „Pokazivač na niz plaćanja računa". I:

```c
typedef enum { PAYMENT_TYPES_CASH, PAYMENT_TYPES_CHECK, PAYMENT_TYPES_CARD, PAYMENT_TYPES_TRANSFER_ORDER, PAYMENT_TYPES_NULL } tfl_PAYMENT_TYPES;
typedef struct { tfl_PAYMENT_TYPES type; uint32_t amount; } tfl_PAYMENTS;
```

---

## 6. FP1 — koja verzija pravila važi za nas

`Programersko_uputstvo_v3.0.1.pdf`, uvodni dio (str. 3):

> Za uređaje proizvedene između 2012 – 06/2021 (**FP1**, T200, T260, FP1 PLUS, T202) verzija TFS-a je **3.4.522**
> Za uređaje proizvedene od 07/2021 i novije (FP1C, T202C) verzija TFS-a je **3.5.XXX**

Posljedice:

- Naš FP1 vozi **TFS 3.4.522**, čiji ZIP nosi **staro** uputstvo (`Programersko_uputstvo_v30.pdf`, 2016) s tačkom c) **„samo u Gotovini"**.
- Novo uputstvo v3.0.1 (2023) je u paketu 3.5.172, ali **pokriva obje familije uređaja** (eksplicitno nabraja FP1) — pa nije isključeno da negativan iznos radi i na 3.4.522. **NEPOTVRĐENO.**
- Greška **573** postoji u listi grešaka **obje** verzije TFS-a → zahtjev „jedna vrsta plaćanja s iznosom 0" važi i za FP1.
- FP1 korisničko uputstvo i Tringova Tring.Pos aplikacija za FP1 rade upravo to: `gotovina 0,00`.

---

## 7. Šta konkretno treba popraviti u kodu

`src/services/tring.ts`:

1. `stampatiFiskalniRacun`: `<VrstaPlacanja>${placanjaXml}</VrstaPlacanja>` → **`<VrstePlacanja>${placanjaXml}</VrstePlacanja>`**.
2. `stampatiReklamiraniRacun`: `<VrstePlacanja />` → **`<VrstePlacanja><VrstaPlacanja><Oznaka>Gotovina</Oznaka><Iznos>0</Iznos></VrstaPlacanja></VrstePlacanja>`**.
3. `novacXml`: korijen `<Zahtjev>` + `<Parametri>` → **`<RacunZahtjev>` + `<NoviObjekat><Oznaka>…</Oznaka><Iznos>…</Iznos></NoviObjekat>`**.
4. `povratNovca`: `VrstaZahtjeva` **8** (a `unosNovca` ostaje 7).
5. Paths: preći na `/unosnovca` i `/povratnovca` (jedina dokumentovana forma), zadržati `/un`,`/pn` kao fallback.
6. `Oznaka` mora biti iz enumeracije `Gotovina|Cek|Kartica|Virman` — case-sensitive, **`Cek` bez kvačice**.
7. Mapirati greške: TFS 535 (`Nedovoljno_novca_u_kasi`) i 573 (`Jedna_vrsta_placanja_sa_iznosom_0_potrebna_za_reklamaciju`) u razumljive poruke; 573 znači „bug u našem XML-u", 535 znači „ponudi UnosNovca".

`src/lib/tringRacun.ts`:

8. `buildTringReklamacija` — `vrstePlacanja: []` → `[{ oznaka: 'Gotovina', iznos: 0 }]`.

---

## 8. Izvori

Primarni (Tringovi vlastiti artefakti):

- Tring download indeks: <https://www.kase.ba/Downloads>
- Uputstvo za integraciju (PDF, s XML tagovima): <https://www.kase.ba/Download/7-uputstvo-za-integraciju.pdf>
- Tring.Fiscal.Server **v3.4.522** (verzija za FP1) + `XML primjeri/` + `XSD/` + `Programersko_uputstvo_v30.pdf` + `Lista_greSaka.pdf`: <https://www.kase.ba/Download/23-Tring.Fiscal.Serve-official.zip>
- Tring.Fiscal.Server **v3.5.172** + `TringFiscalDriverXSDSchemas/` + `Programersko_uputstvo_v3.0.1.pdf` + `Programmers_Manual_v3.0.1.pdf` + `Lista_greSaka_update C.xlsx`: <https://www.kase.ba/Download/26-Tring.Fiscal.Server-CryptoFU.zip>
- linux tring_fiscal_library (`error_codes.h`, `tring_fiscal_library.h`, `.docx`): <https://www.kase.ba/Download/22-linux-tring-fiscal-library.zip>
- C# primjer + `Tring.Fiscal.Driver.dll`: <https://www.kase.ba/Download/6-cs-primjer.zip>
- Klijentski MSI s `/xml/primjeri` (`unosnovca.xml`, `povratnovca.xml`, `stampatireklamiraniracun.xml`, `*.xsd`): <https://www.kase.ba/Download/14-TringFiscal-v2.zip>
- Korisničko uputstvo **FP1**: <https://www.kase.ba/Download/19-Korisnicko-uputstvo-FP1-V1.pdf>
- Korisničko uputstvo Tring Favourite: <https://www.kase.ba/Download/9-KorisnickoUpustvoFavorit.pdf>
- Korisničko uputstvo FK2 (FBiH): <https://www.kase.ba/Download/27-KorisnickoUpustvoKasa-FK2-FBiH.pdf>
- Korisničko uputstvo TringOne: <https://www.betacomm.com.ba/wp-content/uploads/2016/02/Uputstvo-TringOne.pdf>

Sekundarni:

- Yumpu kopija uputstva (koristan tekst, **XML tagovi obrisani**): <https://www.yumpu.com/xx/document/view/7741707/uputstvo-za-integraciju-tring-fiskalni-sistemi> (str. 30–31 = sekcija 7.4)
- Yumpu, novije izdanje: <https://www.yumpu.com/en/document/view/52527676/integracija-softverskih-rjesenja-sa-tring-fiskalnih-ureajima>
- Scribd kopije (**nečitljive kroz web**, samo metapodaci): <https://www.scribd.com/document/427204324/tring>, <https://www.scribd.com/document/611962449/Software-integration-with-Tring-Fiscal>, <https://www.scribd.com/document/696926115/Programmers-Manual-v3-0-1>, <https://www.scribd.com/document/427205254/Uputstvo-Za-Tring-Fiscal-Library>
- iPOS „Fiskalizacija u BiH" (Tremol, ne Tring — samo potvrda poslovnog pravila): <https://www.ipos.hr/WebHelp2/Content/01_Rad_s_programom/ID920000125%20Fiskalizacija%20BiH.htm>
- Ranije istraživanje u ovom repou: `docs/research/2026-08-11-tring-polog-novca.md` (zakonski okvir FBiH, „STANJE U KASI" na presjeku stanja)

## 9. Otvorena pitanja (za provjeru na samom FP1)

1. **Prihvata li naš FP1 (TFS 3.4.522) negativan `Iznos` za Virman/Karticu na reklamaciji?** Test: `srr` s `<VrstePlacanja><VrstaPlacanja><Oznaka>Virman</Oznaka><Iznos>-X</Iznos></VrstaPlacanja></VrstePlacanja>` uz prethodni `UnosNovca` po Virmanu. Očekivanje ako ne radi: TFS 522 `Pogresna_vrsta_placanja…` ili 535.
2. **Je li `PovratNovca` VZ 7 ili 8 na TFS 3.4.522?** Isporučeni `povratnovca.xml` kaže 8, tekst uputstva 7. Testirati oba; ako TFS ruta po adresi komande, razlika je nebitna.
3. **HTTP path**: potvrditi da `/unosnovca` i `/povratnovca` rade; provjeriti rade li i `/un`, `/pn`. Dijagnostika: `GET http://localhost:8085/test` (uputstvo, str. 14).
4. **Šta TFS 3.4.522 vrati na prazan `<VrstePlacanja />` u `srr`** — očekujem 573. Ovo je jedini test koji direktno potvrđuje uzrok trenutnog problema.
5. Da li `UnosNovca` na FP1 štampa nefiskalni isječak (kod FK2/Favourite štampa).
6. Da li se stanje po vrstama plaćanja resetuje dnevnim izvještajem (očekivano da; utiče na to kada nuditi polog).
