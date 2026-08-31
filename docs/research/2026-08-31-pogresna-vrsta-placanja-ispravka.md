# Pogrešno evidentirana vrsta plaćanja na fiskalnom uređaju (FBiH) — šta propisi kažu

Datum istraživanja: 2026-08-31
Uređaj: **Tring FP1**, FBiH, maloprodajni objekat

> ⚠️ **Ovo NIJE pravni ni poreznosavjetnički savjet.** Ovo je pregled onoga što u propisima
> doslovno piše i, jednako važno, onoga što u njima **ne piše**. Cilj je da vlasnik zna šta
> tačno pitati svog knjigovođu i Poreznu upravu FBiH, s tačnim referencama na članove.
> Konačnu ocjenu daje ovlašteni računovođa / porezni savjetnik i PU FBiH.

## Činjenično stanje (polazna pretpostavka, nije istraživano)

Zbog buga u aplikaciji (pogrešan naziv XML omotača `VrstaPlacanja` umjesto `VrstePlacanja`
— vidjeti `docs/research/2026-08-31-tring-reklamacija-vrsta-placanja.md`, §2) fiskalni
uređaj je od početka rada **svaki račun proknjižio kao gotovinski**, iako su mnogi stvarno
naplaćeni virmanom ili karticom. Iznosi, stavke, PDV po stopama i ukupan promet su **tačni**.
Krivo je samo razvrstavanje po vrstama plaćanja u operativnoj memoriji uređaja
(`_GotovinaUnos`, `_StanjeGotovine`). Bug je ispravljen; već izdati računi se ne mogu mijenjati.

---

## TL;DR

1. **Ne postoji član koji doslovno kaže „vrsta plaćanja na računu mora odgovarati stvarnom
   načinu plaćanja".** Ali `Pravilnik o fiskalnim sistemima`, **čl. 8** definiše svaki način
   plaćanja kroz njegovo stvarno značenje („„gotovina" ukoliko se plaća gotovim novcem"…), a
   `Pravilnik o fiskalnim dokumentima`, **čl. 34. st. (1) t. e)** traži da račun sadrži „listu
   **sredstava plaćanja izabranih od strane klijenta**". Kršenje se, ako se uopće procesuira,
   hvata posredno preko **Zakona čl. 52. st. 1. t. e)** — račun nije izdat „sa svim obaveznim
   podacima". Raspon kazne za pravno lice: **2.500–20.000 KM**; odgovorno lice 1.000–3.000 KM;
   poduzetnik 3.000–10.000 KM.
2. **Razradu po vrstama plaćanja iskazuje SAMO presjek stanja (X), ne dnevni izvještaj (Z).**
   Potvrđeno: `Pravilnik o fiskalnim dokumentima` **čl. 39. st. (1) t. k)** (presjek stanja ima
   blok „STANJE U KASI") vs. **čl. 40. st. (1)** (dnevni izvještaj ide a)–k) i **tog bloka nema**).
   U **knjigu dnevnih izvještaja** (čl. 44) odlažu se dnevni i periodični izvještaji — dakle
   **dokument s pogrešnom razradom po vrstama plaćanja NIJE dio obavezne evidencije koja se čuva.**
3. **Propisana procedura ispravke pogrešne vrste plaćanja NE POSTOJI.** Zakon poznaje samo dva
   mehanizma ispravke: *storniranje* prije štampe računa (čl. 34/38) i *reklamirani račun*, koji
   je čl. 37. st. 1. izričito ograničen na slučaj kad se **roba stvarno vraća/reklamira**. Naš
   slučaj nije nijedno od toga → **nije propisano.**
4. **Komanda „službeni ulog gotovine" (cash-in/cash-out, `UnosNovca`/`PovratNovca`) JESTE
   propisana funkcija uređaja** (`Pravilnik o fiskalnim sistemima` čl. 17. st. (5)). Ali **nijedan
   propis ne uređuje kada je i smije li se koristiti za usklađivanje brojača** — to je poslovna
   odluka, ne propisana procedura. Uređaj o tome štampa **nefiskalni** dokument.
5. **Nijedan propis ne nalaže inspektoru da broji gotovinu u ladici** niti propisuje posljedicu
   viška/manjka. Predmet kontrole na prodajnom mjestu je **zatvorena lista od četiri tačke** u
   `Pravilniku o postupcima fiskalizacije`, **čl. 24. st. (2) t. a)–d)** — i gotovine na njoj nema.
   Praksa poređenja ladice s presjekom stanja dolazi iz sekundarnih izvora (serviseri), ne iz propisa.
6. **Rok za ispravku ne postoji jer ne postoji ni propisana ispravka.** Institut „samoprijave"
   u ovom zakonu **nije propisan**. Rok od 15 dana iz `čl. 22. Zakona o Poreznoj upravi FBiH` odnosi se
   na **poreznu prijavu** i aktivira se **samo ako je greška dovela do manje prijavljene porezne obaveze** —
   što ovdje nije slučaj (POTVRĐENO, doslovno u §6).
7. ⭐ **Najvažniji nalaz:** zvanični odgovor u „Najčešće postavljanim pitanjima o fiskalizaciji u
   FBiH" izričito kaže da podaci u fiskalnoj memoriji **„nemaju nikakve veze sa stanjem blagajne
   niti sa sredstvima i načinima plaćanja koji su iskazani na računima, bitno je da je promet
   izvršen i da je nastala porezna obaveza"**, te da je „sasvim svejedno koje se sredstvo koristi".
   To bitno smanjuje procijenjeni rizik. Vidjeti **§5** za puni citat i ogradu o izvoru.

## Preporučeni redoslijed poteza

1. **Ne dirati uređaj.** Ne raditi cash-out, ne raditi reklamirane račune „radi ispravke", nikako ne tražiti
   reset operativne memorije (§3).
2. **Provjeriti čl. 42.** — jesu li računi plaćeni po fakturi uredno povezani (broj fiskalnog računa u
   fakturi, upis u knjigu dnevnih izvještaja). **Ovo je jedina obaveza s izričitom sankcijom koja je ovdje
   realno mogla biti prekršena, i može se ispraviti.** (§1)
3. **Provjeriti s knjigovođom** je li greška uopće dospjela u glavnu knjigu, i uskladiti blagajnu po stvarnom
   prilivu. (§5, §7)
4. **Uputiti pisani upit PU FBiH** — prije svega tražiti potvrdu stava iz zvaničnog FAQ-a. (§7, pitanje 6)
5. **Testirati ispravljeni kod** prije nego se pusti u rad, i planirati tačnu klasifikaciju plaćanja kao
   trajni zahtjev — po novom `Zakonu o fiskalizaciji transakcija` (9/26) vrsta plaćanja određuje koji se
   dokument uopće izdaje. (§6)

---

## 1. Pitanje 1 — postoji li izričita obaveza da vrsta plaćanja bude tačna?

### POTVRĐENO: obaveza evidentiranja postoji NEZAVISNO od načina plaćanja

`Zakon o fiskalnim sistemima` (Sl. novine FBiH 81/09), **čl. 4. st. (1)**, doslovno:

> (1) Obavezu evidentiranja svakog pojedinačno ostvarenog prometa preko fiskalnih uređaja i to
> **nezavisno od načina plaćanja (gotovina, ček, kartica, virman i slično)** ima svako lice koje
> je upisano u odgovarajući registar za promet dobara, odnosno za pružanje usluga klijentima.

Bitno za naš slučaj: ovaj član kaže da se promet mora evidentirati **bez obzira** na način
plaćanja. On **ne** propisuje da evidentirana vrsta plaćanja mora biti tačna. Naš promet **jeste**
evidentiran — čl. 4. nije prekršen.

### POTVRĐENO: značenje svake vrste plaćanja je propisano

`Pravilnik o fiskalnim sistemima` (prečišćeni tekst, pufbih.ba), **čl. 8. (Specifikacija načina
plaćanja)**, doslovno:

> Fiskalni uređaj mora podržati sljedeće načine plaćanja:
> a) „gotovina" ukoliko se plaća gotovim novcem,
> b) „kartica" ukoliko se plaća platnom kreditnom ili debitnom karticom,
> c) „virman" ukoliko se plaća općim nalogom za prijenos sa računa (virmanom),
> d) „ček" ukoliko se plaća kuponima, bonovima, internim karticama i sličnim instrumentima plaćanja.

**Ovo je najbliže „izričitoj obavezi" što u propisima postoji.** Napomena o preciznosti: član je
formalno adresiran na **uređaj** („Fiskalni uređaj mora podržati"), a ne na obveznika, i formuliran
je kao *definicija* („„gotovina" **ukoliko se plaća gotovim novcem**"), ne kao zabrana. Ali iz njega
nedvosmisleno slijedi šta koja oznaka znači.

Isti pravilnik, **čl. 9. st. (6)**:

> (6) Fiskalni uređaj mora osigurati grupiranje, sabiranje i iskazivanje podataka o ostvarenom
> evidentiranom prometu i ostvarenom reklamiranom prometu po poreznim stopama i **načinima plaćanja**.

### POTVRĐENO: vrsta plaćanja je obavezan podatak fiskalnog računa

`Pravilnik o fiskalnim dokumentima` (Sl. novine FBiH 50/20 i 92/20, prečišćeni tekst), **čl. 34.
st. (1) t. e)** — sastavni blokovi fiskalnog računa:

> e) bloka sa ukupnom vrijednosti ostvarenog evidentiranog prometa sa PDV-om (ukupnim iznosom za
> uplatu od strane klijenta), **listom sredstava plaćanja izabranih od strane klijenta, uplaćenim
> iznosom od strane klijenta po svakom izabranom sredstvu plaćanja**, ukupnim uplaćenim iznosom od
> strane klijenta, iznosom za povrat klijentu,

Isti član, **st. (10)** — kako se taj blok štampa:

> b) fiksni tekst „UPLAĆENO:" i prelazak u novi red,
> c) fiksni tekst: „Gotovina", „Ček", „Kartica" ili „Virman", za uplatu odgovarajućim sredstvom
> plaćanja, i jedan ili više znakova razmaka ili se prelazi u novi red,
> d) krajnje desno poravnat uplaćen iznos od strane klijenta po svakom izabranom sredstvu plaćanja
> i prelazi se u novi red,

Formulacija **„izabranih od strane klijenta"** i „**za uplatu odgovarajućim sredstvom plaćanja**" je
ono što daje pravni oslonac tvrdnji da prikazana vrsta plaćanja treba odgovarati stvarnoj.

### POTVRĐENO: sankcija — kako se do nje dolazi

`Zakon` **čl. 33. st. (2)**:

> (2) Obveznik je dužan da fiskalni račun izda **sa svim obaveznim podacima**, koje propisuje
> Ministar Pravilnikom.

`Zakon` **čl. 52. (Prekršaji obveznika), st. (1) t. e)**:

> (1) Novčanom kaznom u iznosu od **2.500 KM do 20.000 KM** kaznit će se za prekršaj pravno lice -
> obveznik, ako:
> […] e) klijentu ne izda fiskalni račun odštampan na fiskalnom uređaju preko kojeg je evidentiran
> promet, bez obzira da li to klijent zahtijeva, u slučaju postojanja bar jednog ispravnog fiskalnog
> uređaja na prodajnom mjestu; **i ako fiskalni račun ne izda sa svim obaveznim podacima iz ovog
> zakona i Pravilnika**,

Ostali rasponi, isti član:

> (2) Za prekršaj iz stava 1. ovog člana, kaznit će se **odgovorno lice u pravnom licu** novčanom
> kaznom u iznosu od **1.000 KM do 3.000 KM**.
> (3) Za prekršaj iz stava 1. ovog člana, kaznit će se **poduzetnik** novčanom kaznom u iznosu od
> **3.000 KM do 10.000 KM**.
> (4) Ako obveznik ponovo učini prekršaj iz stava 1. tač. a), c), k), l), m) u naredne dvije godine,
> izreći će se mjera zabrane obavljanja djelatnosti u trajanju od šest mjeseci do godinu dana.

Napomena: **tačka e) NIJE na listi za mjeru zabrane djelatnosti** (st. 4 nabraja a, c, k, l, m).

### POTVRĐENO: posebna obaveza kod plaćanja po fakturi — ovo je vjerovatniji problem

`Zakon` **čl. 42. (Plaćanje na osnovu fakture)**, doslovno:

> (1) Ako klijent plaćanje obavlja na osnovu fakture, obveznik je dužan da u fakturu unese redni
> broj fiskalnog računa na osnovu kojeg je registrovan promet u fiskalnom uređaju.
> (2) Ostvaren evidentiran promet i ostvaren reklamiran promet preko fiskalnog uređaja za koji se
> plaćanje obavlja na osnovu fakture, obveznik je dužan da iskazuje u **knjizi dnevnih izvještaja**.

Prekršaj je `čl. 52. st. 1. t. k)`:

> k) klijentu koji plaćanje vrši na osnovu fakture, u fakturu ne unese redni broj fiskalnog računa
> na osnovu kojeg je registrovan promet u fiskalnom uređaju; i ako ostvaren evidentiran promet i
> ostvaren reklamiran promet preko fiskalnog uređaja za koji se plaćanje vrši na osnovu fakture,
> ne iskazuje u knjizi dnevnih izvještaja,

⚠️ **Tačka k) JESTE na listi za mjeru zabrane djelatnosti kod ponavljanja (st. 4).** Ako se računima
firmama izdavala i faktura, ova obaveza postoji **potpuno nezavisno** od toga koju je vrstu plaćanja
uređaj proknjižio, i **može se ispuniti i naknadno** (redni broj fiskalnog računa u fakturi, upis u
knjigu dnevnih izvještaja). Ovo je vrijedno provjeriti prije svega ostalog.

### TUMAČENJE (nije doslovno u propisu)

- Pogrešna vrsta plaćanja **ne dira poreznu osnovicu**: PDV i ukupan promet ovise o iznosima i
  stopama, ne o sredstvu plaćanja. Nema ni utaje ni manje uplaćenog poreza. To je bitna
  olakšavajuća okolnost, ali **nije osnov za oslobođenje od prekršaja** — propis takav osnov ne poznaje.
- Nije pronađen nijedan objavljeni prekršajni nalog ni mišljenje PU FBiH koje sankcioniše **isključivo**
  pogrešnu vrstu plaćanja. Vidjeti §5.

---

## 2. Pitanje 2 — koji dokument iskazuje razradu po vrstama plaćanja i čuva li se?

### POTVRĐENO: presjek stanja DA, dnevni izvještaj NE

`Pravilnik o fiskalnim dokumentima`, **čl. 39. (Izgled presjeka stanja i značenje podataka), st. (1)** —
blokovi a) do l), među njima:

> k) bloka sa **iznosom gotovine u kasi, vrijednosti čekova u kasi, vrijednosti prometa karticama u
> kasi i vrijednosti virmana u kasi** u izvještajnom periodu;
> l) bloka sa digitalnim potpisom i fiskalnim logom.

**Čl. 40. (Izgled dnevnog izvještaja i značenje podataka), st. (1)** — blokovi a) do k), gdje su:

> i) bloka sa vrijednostima ostvarenog reklamiranog prometa po svim poreznim stopama […]
> j) bloka sa iznosima ostvarenog reklamiranog poreza po svim poreznim stopama […]
> **k) bloka sa digitalnim potpisom i fiskalnim logom.**

Isto vrijedi i za **periodični izvještaj** — **čl. 42. st. (1)** nabraja blokove a)–k) gdje je k) opet
digitalni potpis; **bloka gotovine/vrsta plaćanja nema.**

**Potvrđeno: dnevni (Z) izvještaj nema bloka gotovine/vrsta plaćanja.** Lista završava na j) (reklamirani
porez), a k) je digitalni potpis. Kod presjeka stanja isti blok k) je „gotovina u kasi", a potpis se
pomjera na l). Ovo je tačno ono što tvrdi `docs/research/2026-08-11-tring-polog-novca.md` — **tvrdnja se
potvrđuje na istim članovima (39 i 40)**.

Sam blok je definisan u **čl. 29. (Blok načina plaćanja)**:

> Blok sa iznosom gotovine u kasi, vrijednosti čekova u kasi, vrijednosti prometa karticama u kasi i
> vrijednošću virmana u kasi u izvještajnom periodu formira se tako što se štampaju:
> a) fiksni tekst **„STANJE U KASI:"**
> b) labela oznake prometa gotovinom, krajnje desno poravnat iznos gotovine u kasi u izvještajnom
> periodu i prelazi se u novi red,
> c) labela oznake vrijednosti prometa čekovima […]
> d) labela oznake prometa karticama […]
> e) labela oznake prometa virmanom, krajnje desno poravnata vrijednost virmana u kasi u izvještajnom
> periodu i prelazi se u novi red.

### POTVRĐENO: šta se zapravo čuva i predaje

`Pravilnik o fiskalnim dokumentima`, **čl. 44. (Knjiga dnevnih izvještaja)**:

> (1) Knjiga dnevnih izvještaja se popunjava na osnovu podataka iz **dnevnih izvještaja, pisanih računa,
> pisanih reklamiranih računa i kopija izdatih faktura**.
> (2) Knjiga dnevnih izvještaja sastoji se od 12 identičnih tabela Obrasca KDI, po jedan za svaki mjesec
> u kalendarskoj godini.
> (3) U knjigu dnevnih izvještaja se za svaki radni dan u kojem je ostvaren promet upisuju podaci o
> datumu i rednom broju dnevnog izvještaja, rednom broju posljednjeg fiskalnog i reklamiranog računa,
> kao i broju izdatih računa.
> (4) U knjizi dnevnih izvještaja se čuvaju **dnevni izvještaji, drugi primjerci pisanih fiskalnih i
> reklamiranih računa, i periodični izvještaj.**
> (5) Knjiga dnevnih izvještaja se **čuva pet godina**.

`Zakon`, **čl. 44.** (isti broj člana, drugi propis) — obaveza formiranja:

> (1) Obveznik je dužan da vodi po jednu knjigu dnevnih izvještaja za svaki fiskalni uređaj u svakoj
> kalendarskoj godini.
> (2) Obveznik je dužan formirati i odštampati dnevni izvještaj na kraju rada, minimalno jednom dnevno,
> ukoliko je tog dana ostvario promet.
> (3) Obveznik je dužan da svaki štampani isječak dnevnog izvještaja registruje i odloži u knjigu
> dnevnih izvještaja hronološkim redom.

`Zakon`, **čl. 43. st. (4)**:

> (4) Fiskalni dokumenti, knjiga dnevnih izvještaja i servisne knjižice predstavljaju **vjerodostojnu
> dokumentaciju od značaja za utvrđivanje poreza.**

### Zaključak za pitanje 2

- **Presjek stanja (X) je jedini dokument s razradom po vrstama plaćanja.**
- **Presjek stanja se ne mora štampati, ne odlaže se u knjigu dnevnih izvještaja i ne čuva se pet
  godina** — nijedan član ne propisuje takvu obavezu. Traži se samo dnevni i periodični izvještaj.
- **Dakle: pogrešna razrada po vrstama plaćanja ne ulazi ni u jedan dokument koji se obavezno čuva ili
  predaje.** Ona živi samo u operativnoj memoriji uređaja i vidljiva je tek ako neko odštampa presjek stanja.
- **NEPOTVRĐENO:** da li se ista razrada prenosi terminalom na server PU FBiH. `Zakon` čl. 45. st. (2)
  govori o prijenosu podataka **iz fiskalne memorije** („osigurati očitavanje podataka iz fiskalnog uređaja
  pomoću terminala i prijenos očitanih podataka **iz fiskalne memorije** ka serveru PU"), a fiskalna
  memorija čuva dnevne izvještaje — ne stanje kase. Po tome PU **ne bi** vidjela razradu po vrstama
  plaćanja. **Ovo obavezno provjeriti kod PU / Tringa prije nego se donese bilo kakva odluka** (vidjeti §7).

---

## 3. Pitanje 3 — postoji li propisana procedura ispravke?

### POTVRĐENO: propisana su tačno dva mehanizma ispravke i nijedan ne pokriva ovaj slučaj

`Zakon`, **čl. 34. (Storniranje evidentiranog prometa)**:

> (1) Greške pri evidentiranju prometa preko fiskalnog uređaja mogu se ispraviti storniranjem
> evidentiranog prometa na odštampanom fiskalnom računu **prije zadavanja komande fiskalnom uređaju za
> štampanje fiskalnog računa**.

`Zakon`, **čl. 37. (Odštampani reklamirani račun)**:

> (1) Greške u evidentiranju prometa preko fiskalnog uređaja koje nisu otklonjene prije zadavanja komande
> fiskalnom uređaju za naplatu iznosa klijentu mogu se ispraviti izdavanjem reklamiranog računa **samo ako
> se kupljena roba reklamira i vraća ili se na drugi način vrši reklamacija robe poslije izdavanja
> fiskalnog računa.**

To je iscrpna lista. Nakon štampe računa, jedini put je reklamirani račun, a on je uslovljen **stvarnim
povratom robe**. Kod nas roba nije vraćena — pogrešna je samo oznaka plaćanja.

⚠️ Dodatno, `Zakon` čl. 52. st. 1. t. h) sankcionira **zloupotrebu** reklamiranog računa:

> h) **klijentu izda reklamirani račun iako se kupljena roba ne reklamira ili ne vraća** ili se na drugi
> način ne vrši reklamacija robe prije izdavanja fiskalnog računa; […]

→ **„Ispravljanje" vrste plaćanja kroz lažni reklamirani račun + novi fiskalni račun bilo bi samo po sebi
prekršaj** iz iste kaznene odredbe (2.500–20.000 KM). To je izričito **ne**-rješenje.

### NIJE PROPISANO: retroaktivna ispravka vrste plaćanja

Pretraženi su cijeli tekstovi `Zakona` i `Pravilnika o fiskalnim dokumentima` na riječi *ispravk-*,
*greška*, *storn-*, *službeni*, *unos novca*. **Ne postoji nijedna odredba o ispravci pogrešno
evidentirane vrste plaćanja na već izdatom računu, niti o usklađivanju brojača gotovine.** Za taj slučaj
propis jednostavno **ne predviđa ništa** — ni postupak, ni rok, ni obrazac, ni prijavu.

### POTVRĐENO: „službeni ulog gotovine" je propisana FUNKCIJA uređaja, ali ne i propisana PROCEDURA

`Pravilnik o fiskalnim sistemima`, **čl. 17. (Operativna memorija), st. (5) i (6)**:

> (5) Operativna memorija mora omogućiti evidentiranje stanja gotovine u fiskalnom uređaju, te da štampa
> informaciju o stanju gotovine prilikom svakog **unosa (cash-in) ili povlačenja službenog uloga gotovine
> (cash-out)**.
> (6) Operativna memorija mora omogućiti razvrstavanje prometa prema načinima plaćanja iz člana 8. ovog
> pravilnika.

Tring FP1 to implementira. `Korisničko uputstvo FP1`, poglavlje 15 „UNOS/PODIZANJE NOVCA (CASH IN/CASH OUT)",
str. 29:

> Unos/podizanje novca vršimo zadavanjem komande nadređenom aplikacijom preko porta fiskalnog uređaja.
> Fiskalni uređaj ima mogućnost da **vodi računa o stanju novca u kasi po svim vrstama plaćanja**. Unos
> novca u kasu se vrši komandom „unesinovac", dok se podizanje novca vrši komandom „povratinovac". […]
> Podaci o stanju novca (uplatama/isplatama) se čuvaju u operativnoj memoriji.

Isti dokument, str. 28:

> FU posjeduje operativnu memoriju takve izrade da omogući evidentiranje stanja gotovine u fiskalnom
> uređaju, te štampa informaciju o stanju gotovine prilikom svakog unosa (cash-in) ili povlačenja
> službenog uloga gotovine (cash-out).

Dokument koji se pritom štampa je **nefiskalni** (potvrđeno za FK2: „štampaju se nefiskalni dokumenti
potvrde unosa ili iznosa i trenutnog stanja službenog depozita u kasi iz operativne memorije" —
`27-KorisnickoUpustvoKasa-FK2-FBiH.pdf`, 8.1.9, str. 35). `Pravilnik o fiskalnim dokumentima` **čl. 45.**
propisuje samo okvir nefiskalnog dokumenta (blokovi „POČETAK NEFISKALNOG TEKSTA" / „ZAVRŠETAK NEFISKALNOG
TEKSTA"); **sadržaj nije propisan**, pa ni ne predstavlja propisanu evidenciju.

### TUMAČENJE — smije li se `PovratNovca` koristiti za usklađivanje?

Ovo je **tumačenje, ne citat.** Argumentacija u oba smjera:

**Za:**
- Zakon, **čl. 2**, definiše gotovinu u kasi tako da uključuje kretanje koje pravi blagajnik:
  > Gotovina u kasi predstavlja razliku zbira gotovine koju su uplatili klijenti i gotovine koju je u
  > kasu unio blagajnik i zbira gotovine vraćene klijentima i **gotovine koju je iz kase iznio blagajnik**.
  Ako blagajnik gotovinu fizički nije ni imao, iznošenje je fikcija; ali ako se novac stvarno polagao na
  žiro račun, „iznošenje iz kase" nije fikcija nego opis stvarnog toka.
- Nijedan propis ne ograničava kada se cash-out smije koristiti.

**Protiv:**
- Ni jedan propis to **ne dozvoljava izričito** kao mehanizam ispravke, i takvim postupkom se ne mijenja
  ništa na već izdatim računima — brojač `_VirmanUnos` ostaje 0, a promet po virmanu i dalje nije iskazan.
- Radi se o **mijenjanju stanja fiskalnog uređaja bez propisanog osnova**, što je materija koju treba
  potvrditi kod PU FBiH i/ili ovlaštenog servisa prije nego se izvede, ne poslije.

**Dodatni argument protiv žurbe:** zvanični FAQ (§5) kaže da podaci koji se čuvaju pet godina „nemaju nikakve
veze sa stanjem blagajne niti sa sredstvima i načinima plaćanja". Ako je to tako, **usklađivanje brojača nema
poreznu svrhu** — ono bi bilo samo operativna higijena da presjek stanja postane upotrebljiv za internu
kontrolu smjene. To je legitiman cilj, ali ne hitan i ne pravno nužan.

→ **Preporuka: ne izvoditi cash-out „na svoju ruku". Pitati PU FBiH i ovlašteni servis (§7).** Ako se ipak
odluči za usklađivanje, zadržati nefiskalni isječak koji uređaj štampa (čl. 17. st. (5)) i uz njega internu
zabilješku s objašnjenjem i datumom — nije propisano, ali je jedini trag koji uopće postoji.

### Ima li obaveze prijave, zapisnika ili ovlaštenog servisa?

- **Obavijest ovlaštenom servisu** propisana je samo za **neispravan uređaj** (`Zakon` čl. 52. st. 1. t. n):
  „poduzima radnje na neispravnom fiskalnom uređaju i odmah, a najkasnije u roku od 24 sata, ne obavijesti
  ovlašteni servis"). **Naš uređaj nije neispravan** — greška je bila u nadređenoj aplikaciji. Ova obaveza
  se, po slovu člana, ne aktivira.
- **Reset operativne memorije** koji bi obrisao brojače (`Zakon` čl. 48. st. 4–5) predstavlja **neispravnost
  fiskalnog uređaja** i smije ga izvesti **isključivo ovlašteni serviser**:
  > (4) Reseti kojima se briše cjelokupni sadržaj operativne memorije, brisanje podataka o ostvarenom
  > evidentiranom i ostvarenom reklamiranom prometu i brisanje baze artikala u operativnoj memoriji,
  > **predstavljaju neispravnost fiskalnog uređaja.**
  > (5) Resete iz stava 4. ovog člana obavlja isključivo ovlašteni serviser.
  → **Nikako ne pokušavati riješiti problem resetom.**
- **Zapisnik / prijava PU:** **nije propisano** za ovaj slučaj (vidjeti i §6).

---

## 4. Pitanje 4 — šta inspekcija PU FBiH stvarno poredi?

### POTVRĐENO: zakon uređuje kontrolu samo načelno

`Zakon`, **čl. 50.**:

> (1) U primjeni ovog Zakona obavljaju se stalne kontrole kako slijedi
> - kontrola fiskalnih sistema,
> - kontrola evidentiranja prometa putem fiskalnih proizvoda,
> - kontrola ovlaštenih servisa i ovlaštenih servisera.
> (2) Kontrolu iz prethodnog stava vrši Ministarstvo.
> (3) **Pravilnikom se propisuje tehnika i oblik kontrole**, koja u sebi sadrži posebno:
> - kontrolu tehničkih i funkcionalnih osobina fiskalnih proizvoda,
> - kontrolu evidentiranja prometa preko fiskalnih sistema, […]

### NIJE PROPISANO: brojanje gotovine u ladici

**Ni u `Zakonu` ni u `Pravilniku o fiskalnim dokumentima` ni u `Pravilniku o fiskalnim sistemima` nema
odredbe koja nalaže inspektoru da uporedi fizičku gotovinu u ladici sa „STANJEM U KASI", niti odredbe koja
propisuje posljedicu utvrđenog viška ili manjka gotovine.** Zakon o fiskalnim sistemima uopće ne poznaje
prekršaj „neslaganje stanja gotovine".

### POTVRĐENO: predmet kontrole na prodajnom mjestu je ZATVORENA lista od četiri tačke

Ovo je najvažniji nalaz za ovo pitanje. `Pravilnik o postupcima fiskalizacije` (Sl. novine FBiH 50/20),
**čl. 24. (Obaveze Porezne uprave), st. (2)** — tekst provjeren direktno iz PDF-a na pufbih.ba:

> (2) Porezna uprava vrši kontrolu evidentiranja prometa putem fiskalnih sistema, odnosno kontrolu podataka
> koji se putem terminala šalju Poreznoj upravi i **kontrolu kod obveznika na prodajnom mjestu kojom se
> provjerava:**
> a) evidentiranje prometa i izdavanje fiskalnih računa i reklamiranih fiskalnih računa klijentima od strane
> obveznika;
> b) posjedovanje primjeraka pisanih fiskalnih računa i pisanih reklamiranih fiskalnih računa izdatih
> klijentima od strane obveznika;
> c) posjedovanje i ažurno vođenje servisnih knjižica za fiskalne sisteme;
> d) posjedovanje i ažurno vođenje knjige dnevnih izvještaja.

**Lista je a)–d) i završava. Brojanje gotovine u ladici, presjek stanja i stanje u kasi se u njoj ne
spominju.** Ovo je jedina odredba u cijelom setu propisa koja taksativno nabraja šta se provjerava na
prodajnom mjestu.

### POTVRĐENO: jedini propisani obrazac za korekciju ne pokriva vrste plaćanja

Isti član, **st. (1)**:

> (1) Porezne uprava je dužna po zaprimljenom **Obrascu ZKFDI** i duplikatu/kopiji dnevnog izvještaja iz
> fiskalnog sistema od ovlaštenog servisa/servisera, izvršiti **korekciju dnevnog prometa** u roku od dva
> dana od dana zaprimanja.

`Obrazac ZKFDI` je, po čl. 2. istog pravilnika, **„Zahtjev za korekciju/formiranje dnevnih izvještaja"**.
Iz čl. 12. st. (4) vidi se čemu služi — usklađivanju **prometa** s dnevnih i periodičnih izvještaja s
prometom na serveru PU:

> (4) Ovlašteno lice Porezne uprave će izvršiti poređenje prometa sa Periodičnih izvještaja i Dnevnih
> izvještaja odloženih u Knjizi dnevnih izvještaja kod obveznika sa prometom dostavljenim na server Porezne
> uprave. Ovlašteno lice Porezne uprave će utvrditi razliku prometa i popunjen Obrazac ZKFDI dostaviti licu
> u Poreznoj upravi da se evidentiraju podaci na server Porezne uprave.

**To je jedini propisani mehanizam naknadne korekcije u cijelom setu propisa — i odnosi se isključivo na
IZNOS prometa u dnevnim izvještajima, ne na vrste plaćanja.** U našem slučaju promet je tačan, pa ovaj
obrazac nije primjenjiv.

### NIJE PRONAĐENO: zvanična saopštenja PU FBiH o brojanju gotovine

Pretraživani su `pufbih.ba` i `fmf.gov.ba` na saopštenja, uputstva i mišljenja o poređenju fizičke gotovine
s presjekom stanja i o posljedicama viška/manjka. **Nije pronađeno ništa.** Saopštenja PU FBiH koja postoje
tiču se broja kontrola, pečaćenja objekata i kazni za **neizdavanje fiskalnog računa**.

Također **nije pronađen** podzakonski akt naziva „Pravilnik o postupku i tehnici kontrole fiskalnih sistema"
koji `čl. 50. st. (3) Zakona` najavljuje. Materija je razasuta po tri postojeća pravilnika (o fiskalnim
sistemima, o fiskalnim dokumentima, o postupcima fiskalizacije).

### SEKUNDARNI IZVOR (serviser, NE propis): „inspektori to često traže"

FAQ Intercomp d.o.o. Visoko (ovlašteni distributer fiskalnih uređaja u FBiH),
<https://intercomp.ba/fiskalizacija/pitanjafiskalizacija/>, doslovno:

> Ukoliko ste fizički izvršili unos gotovine u vašu kasu, morate to evidentirati i kroz fiskalni uređaj.
> […] Gotovina u kasi predstavlja razliku zbira gotovine koju su uplatili klijenti i gotovine koju je u kasu
> unio blagajnik i zbira gotovine vraćene klijentima i gotovine koju je iz kase iznio blagajnik. **Taj se
> zbir može vidjeti na Presjeku stanja, i inspektori to često traže. Možete provjeravati sami sebe na taj
> način.**

⚠️ Ovo je **tvrdnja servisera o praksi, ne propis.** Zanimljivo je da isti Intercomp u svojoj vlastitoj listi
onoga što treba pripremiti za inspekciju **ne navodi gotovinu**:

> Rješenje o fiskalizaciji – na pokaz, Istaknut Obrazac OZK (A3 Obavjest o obavezi izdavanja fiskalnog
> računa), Istaknut cjenovnik za robe i usluge ili kod svakog artikla istaknuta cijena sa brojem evidencije,
> Servisna knjižica za fiskalnu kasu – na pokaz, Ažurnost knjige dnevnih izvještaja (obrazac KDI)

Ta lista se **poklapa s čl. 24. st. (2) Pravilnika o postupcima fiskalizacije**, ne s tvrdnjom o gotovini.

### Zaključak za pitanje 4

- **Ne postoji propis koji nalaže poređenje fizičke gotovine s presjekom stanja**, niti prekršaj „višak/manjak
  gotovine" u Zakonu o fiskalnim sistemima.
- Ako inspektor to ipak zatraži, to radi izvan taksativne liste iz čl. 24. st. (2) — **ali to ne znači da ne
  smije**, jer čl. 50. Zakona kontrolu postavlja široko. Eventualne posljedice bi se tražile u **drugim**
  propisima (blagajničko poslovanje, Zakon o Poreznoj upravi FBiH, propisi o gotovinskom prometu) — što je
  izvan opsega ovog istraživanja i pitanje za knjigovođu.

---

## 5. Pitanje 5 — praksa i mišljenja o ovom scenariju

### ⭐ POTVRĐENO — zvanični odgovor koji direktno pokriva ovaj slučaj

Dokument **„Najčešće postavljana pitanja o fiskalizaciji u Federaciji BiH"** — zvanični odgovori nadležnog
organa, PDF distribuiran preko FEB d.d. Sarajevo:
<https://feb.ba/wp-content/uploads/2021/02/NAJCESCE-POSTAVLJENA-PITANJA-O-FISKALIZACIJI.pdf>

Na pitanje *„U slučajevima kada se plaćanje djelimično ili u potpunosti vrši bezgotovinskim plaćanjem
(virmanom), kako to provesti kroz fiskalni uređaj?"* odgovor glasi, **doslovno**:

> 2) Fiskalni sistemi ravnopravno tretiraju sljedeća sredstva plaćanja: gotovina, ček, virman i kartica.
> **Sasvim je svejedno koje se sredstvo koristi** i moguće je na istom računu koristiti više sredstava, i to
> **nema nikakvog uticaja na sam račun** osim što se pojavljuje više komponenti ukupno naplaćenog iznosa.
> Naglašavamo, da podaci koji se upisuju u fiskalnu memoriju i koji se čuvaju najmanje narednih pet godina,
> **nemaju nikakve veze sa stanjem blagajne niti sa sredstvima i načinima plaćanja koji su iskazani na
> računima, bitno je da je promet izvršen i da je nastala porezna obaveza.**

Iz istog seta odgovora, o odnosu propisa i internog knjigovodstva:

> Zakon o fiskalnim sistemima predviđa principe odnosno mehanizme koji stoje na raspolaganju za rješavanje
> konkretnih situacija, kao što ima i određena ograničenja koja se moraju poštovati, **kojim se ne može
> propisivati način na koji će se raditi interno knjigovodstvo kod bilo kojeg poreznog obveznika**, jer ne
> može se propisati model knjiženja koji će obveznik primijeniti u svom sistemu, **svaki sistem je prihvatljiv
> dok se nalazi u okviru korištenja dozvoljenih opcija.**

I šire, o tome šta fiskalna kasa uopće mjeri:

> […] jer se putem fiskalnih kasa evidentira **ostvareni promet, a ne prihod** i pri tom obračunati porez na
> dodanu vrijednost.

**Značaj za naš slučaj — ovo je najvažniji nalaz cijelog istraživanja:**

1. Podaci u **fiskalnoj memoriji** (ono što se čuva pet godina i prenosi PU) **„nemaju nikakve veze sa
   stanjem blagajne niti sa sredstvima i načinima plaćanja"**. Naša greška je isključivo u **operativnoj**
   memoriji (stanje u kasi po vrstama plaćanja). Prema ovom odgovoru, ono što je porezno relevantno — promet
   i porezna obaveza — **kod nas je tačno.**
2. „Sasvim je svejedno koje se sredstvo koristi" i „nema nikakvog uticaja na sam račun" — nadležni organ
   izričito degradira vrstu plaćanja na informativni podatak.
3. Način knjiženja je stvar obveznika, ne fiskalnog propisa — dakle knjigovodstvo se **smije** i **treba**
   voditi po stvarnom prilivu (izvod žiro računa, POS obračun), a ne po tome šta je uređaj proknjižio kao
   gotovinu.

⚠️ **Ograda (ista kao u `docs/research/2026-08-13-fiskalni-racun-zbirna-stavka-regulativa.md`):** dokument
sam ne navodi potpisnika. Po sadržaju i formulacijama („Naglašavamo…") potiče od nadležnog organa (FMF/PU
FBiH) i tako se u praksi i koristi, ali **nije objavljen kao formalno mišljenje s brojem akta**. Ako se na
njega treba osloniti u postupku, **treba zatražiti zvanično pisano mišljenje PU FBiH** (vidjeti §7, pitanje 6).

### Kako se to knjigovodstveno zatvara

Ovo je **domen knjigovođe, ne ovog dokumenta.** Ono što je iz propisa jasno:

- Fiskalna kasa evidentira **promet**, a ne priliv. Blagajnički dnevnik i saldo blagajne su kategorije
  računovodstvenih propisa, ne Zakona o fiskalnim sistemima.
- Ako je blagajna dosad knjižena **po Z-izvještaju** (a Z-izvještaj ionako ne sadrži razradu po vrstama
  plaćanja — §2), onda ovaj bug **možda uopće nije ni dospio u glavnu knjigu.** Prvo pitanje knjigovođi je
  upravo to (§7, pitanje 2).
- Ako jeste — očekivano zatvaranje je preknjižavanje s blagajne na **potraživanja od kupaca** za iznose koji
  su stvarno naplaćeni virmanom, uz dokaz iz izvoda žiro računa. **NEPOTVRĐENO kao propisana procedura** —
  nije pronađen nijedan javno dostupan tekst iz FBiH (FEB, Revicon, FinConsult, ZIPS) s konkretnim kontima za
  ovaj slučaj; sav takav stručni sadržaj je iza pretplate.

**POTVRĐENO — okvir iz računovodstvenog propisa** (`Zakon o računovodstvu i reviziji u FBiH`, Sl. novine FBiH
15/21; tekst provjeren direktno iz PDF-a na pufbih.ba):

`čl. 18. st. (4)`:

> (4) U dnevnik blagajne se unose poslovne promjene koje nastaju **po osnovi gotovine** i drugih vrijednosti
> koje se vode u blagajni pravne osobe. Dnevnik blagajne zaključuje se na kraju svakog radnog dana i dostavlja
> se računovodstvu […]

`čl. 20. st. (3) i (4)`:

> (3) U poslovne knjige unose se podaci po načelu nastanka poslovnih događaja, a na temelju **vjerodostojnih
> knjigovodstvenih isprava**.
> (4) **Naknadna ispravka unesenog podatka provodi se kao nova knjigovodstvena stavka** tako da bude vidljiv
> učinak promjene iz razlike novog i prethodnog podatka.

**TUMAČENJE (ne citat):** dnevnik blagajne se po propisu vodi **po gotovini**, na osnovu **vjerodostojne
isprave**. Z-izvještaj s pogrešnom oznakom sredstva plaćanja nije vjerodostojan dokaz o prilivu gotovine —
to su izvod banke i POS obračun. I ispravka se, ako treba, provodi **kao nova stavka**, ne prepravkom
postojeće. To podupire pristup „knjiži po stvarnom prilivu", ali **konačnu ocjenu daje knjigovođa.**

### NIJE PRONAĐENO

Nije pronađen nijedan objavljeni slučaj, prekršajni nalog ni pisano mišljenje PU FBiH koje se bavi
**isključivo** pogrešno evidentiranom vrstom plaćanja na fiskalnoj kasi. To nije dokaz da problem ne postoji
— samo znači da nema javno dostupne prakse na koju bi se moglo pozvati.

---

## 6. Pitanje 6 — rok za ispravku, samoprijava

### NIJE PROPISANO: rok

Rok za ispravku ne postoji **jer ne postoji propisana ispravka** (§3). Jedini rokovi koji se u `Zakonu`
vezuju za obveznika i greške su:

- `čl. 34.` / `čl. 38.` — storniranje **prije** komande za štampu (dakle rok je „prije štampe", ne dani);
- `čl. 52. st. 1. t. n)` — obavijest ovlaštenom servisu **„odmah, a najkasnije u roku od 24 sata"**, ali
  **samo za neispravan fiskalni uređaj**. Naš uređaj nije neispravan.

Pretraga cijelog teksta `Zakona` na *„obavijest"*, *„obavještenje"*, *„u roku od"* pokazuje da obveznik nema
nijednu opštu obavezu naknadnog obavještavanja PU o uočenoj grešci u evidentiranju. Jedine obaveze
obavještavanja padaju na ovlaštenog proizvođača/zastupnika i servis (čl. 53–55).

### NIJE PROPISANO: samoprijava

**Zakon o fiskalnim sistemima ne poznaje institut samoprijave.** Nema odredbe o dobrovoljnom prijavljivanju
greške, niti o umanjenju kazne zbog toga.

### POTVRĐENO: obaveza ispravke postoji u drugom propisu — ali se ovdje NE aktivira

`Zakon o Poreznoj upravi FBiH` (Sl. novine FBiH 44/22, prečišćeni tekst), **čl. 22**, doslovno (tekst
provjeren direktno iz PDF-a na fuzip.gov.ba):

> Porezni obveznik koji otkrije da je napravljena greška ili propust na poreznoj prijavi koju je ranije podnio
> ili ju je podnio neko u njegovo ime, **a koja je dovela do manje prijavljene porezne obaveze**, podnosi
> izmijenjenu poreznu prijavu u kojoj je izvršena ispravka greške ili propusta **u roku od petnaest (15) dana
> od otkrivanja greške ili propusta**.

**Ovaj rok se ovdje NE aktivira**, iz dva razloga: (a) odnosi se na **poreznu prijavu**, ne na podatke u
fiskalnom uređaju; (b) uslovljen je time da je greška dovela do **manje prijavljene porezne obaveze** — a kod
nas su promet i PDV tačni, pa porezna obaveza nije umanjena. Ista odredba daje i pravo (ne obavezu) izmjene
prijave u ostalim slučajevima: „Porezni obveznik **može** izmijeniti prethodno podnesenu poreznu prijavu."

⚠️ **Ali:** upravo zato je bitno da knjigovođa pisano potvrdi da nijedna prijava nije bila netačna (§7,
pitanje 3). Ako bi se ispostavilo da jeste, **rok od 15 dana teče od otkrivanja** — a greška je otkrivena sada.

Za indirektne poreze, `Zakon o postupku indirektnog oporezivanja BiH` **čl. 104. st. (3)** poznaje dobrovoljnu
ispravku („Lica koja imaju obaveze indirektnih poreza koja dobrovoljno isprave stanje indirektnog poreza ili
isprave nepravilne dokumente ili druge netačne informacije prethodno dostavljene UIO neće biti odgovorna.") —
**citat preuzet iz sekundarnog izvora (paragraf.ba), nije nezavisno provjeren u službenom tekstu.**

### Kontekst: novi zakon je već usvojen

`Zakon o fiskalizaciji transakcija u FBiH`, **Sl. novine FBiH 9/26** (04.02.2026.) — vidjeti
`docs/research/2026-08-13-fiskalni-racun-zbirna-stavka-regulativa.md`, §4. Stari fiskalni sistemi se koriste
u prelaznom periodu, a primjena počinje tek nakon podzakonskih akata.

⚠️ **Ali pažnja — u novom zakonu vrsta plaćanja postaje odlučujuća, ne informativna.** Tekst provjeren
direktno (PDF na feb.ba):

`čl. 20. st. (1) (Obaveza izdavanja fiskalnih računa)`:

> (1) Za transakciju obveznika iz člana 6. st. (2) i (4) ovog zakona, a koja nije obuhvaćena članom 15. ovog
> zakona, izdaje se fiskalni račun, **ako je plaćena ili će biti plaćena gotovinski.**

`čl. 15. st. (1) (Obaveza izdavanja e-fakture)`:

> Za B2B transakcije, mora se izdati, poslati i prihvatiti e-faktura, **ukoliko je plaćena ili će biti plaćena
> bezgotovinski**, ili ukoliko se vrši kombinovano plaćanje.

Dakle po novom zakonu **gotovinsko vs. bezgotovinsko plaćanje određuje koji se dokument uopće izdaje**
(fiskalni račun vs. e-faktura). Ista greška u budućnosti ne bi bila „pogrešna oznaka" nego **izdavanje
pogrešne vrste dokumenta.**

⚠️ **Ali pažnja na definiciju — kartica po novom zakonu spada u GOTOVINSKO plaćanje.** `čl. 11. (Načini
plaćanja u transakcijama)`, doslovno:

> Gotovinskim plaćanjem, u smislu ovog zakona, smatra se direktna predaja gotovog novca između učesnika
> transakcije, **kao i plaćanje putem platne kartice**, bona, vaučera ili drugog sličnog sredstva plaćanja,
> izvršeno od strane učesnika transakcije.
> Bezgotovinskim plaćanjem, u smislu ovog zakona, smatra se prijenos novčanih sredstava s računa platioca na
> račun primaoca, kao i namirenje međusobnih novčanih obaveza i potraživanja na osnovu obligacionog odnosa
> između učesnika, bez upotrebe gotovine.
> Kombinovanim plaćanjem […] plaćanje po jednom računu koje je izvršeno dijelom gotovinski, a dijelom
> bezgotovinski.

**Posljedica za naš bug:** dio greške koji se tiče **kartice** prospektivno prestaje biti problem (kartica i
jest „gotovinsko" po novoj definiciji). Dio koji se tiče **virmana** ostaje, i postaje ozbiljniji.

Ovo je jak argument da se popravljeni kod (`VrstePlacanja`) obavezno i temeljito testira, te da se tačna
klasifikacija plaćanja planira kao trajni zahtjev aplikacije — s tim da **mapiranje četiri stare oznake
(Gotovina/Cek/Kartica/Virman) na novu podjelu gotovinsko/bezgotovinsko/kombinovano nije 1:1.**

Za razliku od 81/09, novi zakon **uvodi izričit standard tačnosti podataka na računu** — `čl. 18. st. (5)`:
„Obveznici koji izdaju račune dužni su navesti tačne i potpune podatke na računu." (citat iz izvještaja
pomoćnog istraživanja, **nije nezavisno provjeren** u tekstu 9/26.)

**Nije istraživano:** da li novi zakon uvodi postupak ispravke, i kako tačno tretira prelazni period. Zaseban zadatak.

---

## 7. Šta konkretno pitati knjigovođu / Poreznu upravu

Ova pitanja su formulisana tako da se na njih može odgovoriti s referencom na član, a ne mišljenjem:

1. **Za knjigovođu:** „Jesmo li ispunili `čl. 42. Zakona o fiskalnim sistemima` za sve račune plaćene po
   fakturi — je li redni broj fiskalnog računa unesen u fakturu, i jesu li ti računi iskazani u knjizi
   dnevnih izvještaja? Ako nisu, možemo li to ispraviti sada i kako to dokumentujemo?" (Ovo je jedina
   obaveza s izričitom sankcijom i mjerom zabrane djelatnosti kod ponavljanja — `čl. 52. st. 1. t. k)`
   i st. 4.)
2. **Za knjigovođu:** „Kako su ovi računi do sada knjiženi — je li blagajnički dnevnik knjižen po Z-izvještaju
   ili po stvarnom prilivu? Postoji li u glavnoj knjizi fiktivni saldo blagajne i kako ga zatvaramo tako da
   se slaže s izvodima žiro računa i POS terminala?"
3. **Za knjigovođu:** „Je li ijedna poreska prijava (PDV, dobit) bila netačna zbog ovoga? Ako nije — potvrdi
   to pisano, jer je to najjači argument da nema porezne posljedice."
4. **Za Poreznu upravu FBiH (pisani upit, ne telefonski):** „Prenosi li se preko terminala na server PU
   razrada prometa po vrstama plaćanja (stanje u kasi iz operativne memorije), ili samo podaci iz fiskalne
   memorije po `čl. 45. st. (2) Zakona`? Vidi li PU uopće ovaj podatak?"
5. **Za Poreznu upravu FBiH:** „Postoji li propisana procedura za usklađivanje stanja gotovine u operativnoj
   memoriji fiskalnog uređaja sa stvarnim stanjem u ladici kad je razlika nastala pogreškom nadređene
   softverske aplikacije, a promet, PDV i iznosi su tačni? Smije li se za to koristiti komanda cash-out
   („povlačenje službenog uloga gotovine" iz `čl. 17. st. (5) Pravilnika o fiskalnim sistemima`) i kako se to
   dokumentuje?"
6. **Za Poreznu upravu FBiH — najvažnije pitanje:** „Molimo pisanu potvrdu stava iz zvaničnih odgovora
   „Najčešće postavljana pitanja o fiskalizaciji u FBiH", gdje stoji da podaci u fiskalnoj memoriji „nemaju
   nikakve veze sa stanjem blagajne niti sa sredstvima i načinima plaćanja koji su iskazani na računima,
   bitno je da je promet izvršen i da je nastala porezna obaveza". Ako taj stav važi, smatra li se pogrešno
   iskazana vrsta plaćanja — uz tačan promet, tačan PDV i uredno izdate račune — prekršajem iz
   `čl. 52. st. 1. t. e) Zakona`?" (Onaj FAQ nema broj akta ni potpisnika; ovim se dobija dokument na koji
   se može pozvati.)
7. **Za ovlašteni servis (Tring / zastupnik):** „Šta preporučujete za usklađivanje brojača `_StanjeGotovine`
   na FP1 kad je razlika nastala zbog greške u aplikaciji? Postoji li servisna procedura, i pravite li o tome
   zapis u servisnoj knjižici?" (Napomena: **ne tražiti reset operativne memorije** — `čl. 48. st. 4. Zakona`
   ga izričito kvalifikuje kao neispravnost uređaja.)

---

## 8. Izvori

Primarni — propisi:

- `Zakon o fiskalnim sistemima`, Sl. novine FBiH br. 81/09 (PDF, tekst provjeren direktno):
  <https://fuzip.gov.ba/wp-content/uploads/2022/09/Zakon_o_fiskalnim_sistemima_sl_novine_fbih_broj_81_2009-9.pdf>
  (kopija na PU FBiH: <https://www.pufbih.ba/v1/public/upload/zakoni/c7edb-zakon-o-fiskalnim-sistemima.pdf>)
- `Pravilnik o fiskalnim dokumentima`, Sl. novine FBiH 50/20 i 92/20, prečišćena neslužbena verzija,
  Porezna uprava FBiH (PDF, tekst provjeren direktno):
  <https://www.pufbih.ba/v1/public/upload/zakoni/82eed-pravilnik-o-fiskalnim-dokumentima-precisceni-tekst.pdf>
- `Pravilnik o fiskalnim sistemima`, prečišćeni tekst, Porezna uprava FBiH (PDF, tekst provjeren direktno):
  <https://www.pufbih.ba/v1/public/upload/zakoni/0655d-pravilnik-o-fiskalnim-sistemima-precisceni-tekst.pdf>
- `Pravilnik o postupcima fiskalizacije`, Sl. novine FBiH 50/20, Porezna uprava FBiH (PDF, tekst provjeren
  direktno — izvor čl. 24. st. (1) i (2), čl. 12. st. (4)):
  <https://www.pufbih.ba/v1/public/upload/zakoni/0d797-pravilnik-o-postupcima-fiskalizacije-50-20.pdf>
- `Pravilnici o izgledu i sadržaju ostalih pratećih dokumenata` (uz čl. 51. st. 3. Zakona):
  <https://www.upfbih.ba/uimages/dokumenti/pravilnici_o_izgledu_i_sadrzaju_ostalih_pratecih_dokumenata_bos.pdf>
- Kopija `Pravilnika o fiskalnim dokumentima` na Federalnom ministarstvu finansija:
  <https://www.fmf.gov.ba/Content/Open/100953?n=Pravilnik_o_fiskalnim_dokumentima.pdf>

Primarni — Tring:

- `Korisničko uputstvo FP1`: <https://www.kase.ba/Download/19-Korisnicko-uputstvo-FP1-V1.pdf>
- `Korisničko uputstvo FK2 (FBiH)`: <https://www.kase.ba/Download/27-KorisnickoUpustvoKasa-FK2-FBiH.pdf>
- Tring download indeks: <https://www.kase.ba/Downloads>

Ranija istraživanja u ovom repou (izvor citata koji se ovdje ponovo koriste):

- `docs/research/2026-08-11-tring-polog-novca.md` — zakonski okvir, „STANJE U KASI", čl. 2 i čl. 44
- `docs/research/2026-08-31-tring-reklamacija-vrsta-placanja.md` — XSD, `VrstePlacanja` bug, `UnosNovca`/`PovratNovca`

- `Zakon o fiskalizaciji transakcija u FBiH`, Sl. novine FBiH 9/26 (04.02.2026.), sken službenih novina
  (tekst provjeren direktno — čl. 15, čl. 20):
  <https://feb.ba/wp-content/uploads/2026/02/Zakon-o-fiskalizaciji-transakcija-u-FBiH-1.pdf>

- `Zakon o Poreznoj upravi FBiH`, Sl. novine FBiH 44/22, prečišćeni tekst (tekst provjeren direktno — čl. 22):
  <https://fuzip.gov.ba/wp-content/uploads/2022/11/Zakon_o_poreznoj_upravi_fbih_sl_novine_fbih_44_2022.pdf>
- `Zakon o računovodstvu i reviziji u FBiH`, Sl. novine FBiH 15/21, PDF Porezne uprave FBiH (tekst provjeren
  direktno — čl. 18. st. (4), čl. 20. st. (3) i (4)):
  <https://www.pufbih.ba/v1/public/upload/zakoni/8ff22-zak-o-racunovodstvu-i-reviziji-u-fbih-hrv..pdf>

Zvanični odgovori / tumačenja:

- „Najčešće postavljana pitanja o fiskalizaciji u Federaciji BiH" (zvanični odgovori nadležnog organa, PDF
  preko FEB d.d. Sarajevo; **potpisnik nije naveden u dokumentu**):
  <https://feb.ba/wp-content/uploads/2021/02/NAJCESCE-POSTAVLJENA-PITANJA-O-FISKALIZACIJI.pdf>

Sekundarni:

- FAQ Intercomp d.o.o. Visoko (ovlašteni distributer): <https://intercomp.ba/fiskalizacija/pitanjafiskalizacija/>
  (citati provjereni direktno). Isti izvor o ispravci: „Račun koji je već otkucan ne možete ispraviti.
  Potrebno je praviti reklamirani fiskalni račun."
- `Zakon o postupku indirektnog oporezivanja BiH`, čl. 104. st. (3) — **citat preuzet posredno, nije provjeren
  u službenom tekstu**: <https://www.paragraf.ba/propisi/bih/zakon-o-postupku-indirektnog-oporezivanja.html>

Pretraženo bez rezultata (dokumentovano da se ne ponavlja): stručni tekstovi FEB / Revicon / FinConsult /
Fircon-ZIPS o knjiženju ovakvog prometa (sve iza pretplate); objavljena mišljenja PU FBiH ili prekršajni
predmeti o netačnoj vrsti plaćanja; forum.klix.ba (HTTP 403 za automatski dohvat).
⚠️ Pretrage uporno vraćaju **srbijanske** izvore koji opisuju ispravku dokumentom „Promet-Refundacija" —
to je srbijanski sistem fiskalizacije i **ne primjenjuje se u FBiH**.

## 9. Otvorena pitanja

1. **Prenosi li se stanje po vrstama plaćanja terminalom na server PU FBiH?** `Zakon` čl. 45. st. (2) govori
   o podacima **iz fiskalne memorije**, što bi značilo NE — ali to nije potvrđeno. Ovo je najvažnije otvoreno
   pitanje jer određuje da li PU uopće može vidjeti grešku bez izlaska na teren.
2. **Resetuje li dnevni izvještaj brojače stanja u kasi na FP1?** Ako da, „STANJE U KASI" pokazuje samo
   dnevnu, ne kumulativnu grešku, i problem je manji nego što izgleda. `Pravilnik o fiskalnim dokumentima`
   govori o „izvještajnom periodu" za taj blok, što sugeriše da da — **ali eksplicitno nije rečeno.**
   Provjeriti štampanjem presjeka stanja odmah nakon Z-izvještaja.
3. Postoji li zvanično pisano mišljenje PU FBiH o pogrešno evidentiranoj vrsti plaćanja.
   (Zaseban „Pravilnik o postupku i tehnici kontrole" iz `čl. 50. st. (3) Zakona` **nije pronađen** —
   izgleda da nikad nije donesen pod tim nazivom; materija je u čl. 24. `Pravilnika o postupcima
   fiskalizacije`.)
