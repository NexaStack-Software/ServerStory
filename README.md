# ServerStory

Sieh in wenigen Minuten, was deine Website laut deinen Server-Logs **wirklich** an
Seitenaufrufen (und ungefähr an Besuchern) hatte — direkt aus der Quelle, ohne Cookies
und ohne Tracking-Tool. Optional kannst du die Zahlen direkt mit Google Analytics
vergleichen und siehst sofort, ob Google Analytics weniger zählt als die Realität.

**Alles läuft lokal in deinem Browser. Deine Logdatei wird nirgendwohin hochgeladen.**

Du brauchst kein Programm, keinen Account und keine Installation — nur einen Browser
(Chrome, Edge, Firefox oder Safari).

![ServerStory: Logdatei auswählen, auswerten, Ergebnis ansehen](screenshot.png)

---

## 1. Tool herunterladen

> **Schon als ZIP-Datei bekommen?** Wenn du ServerStory per E-Mail oder Link als
> ZIP-Datei erhalten hast, überspring diesen Schritt und mach direkt bei
> **Schritt 2 (Entpacken)** weiter.

So lädst du es von dieser Seite herunter:

1. Klicke oben auf dieser Seite auf den grünen Button **`< > Code`**.
2. In dem kleinen Menü, das aufklappt, auf **`Download ZIP`** klicken.
3. Es wird eine Datei namens `ServerStory-main.zip` in deinen Download-Ordner geladen.

## 2. Entpacken

Die heruntergeladene ZIP-Datei muss einmal „ausgepackt" werden:

- **Windows:** Rechtsklick auf die ZIP-Datei → **„Alle extrahieren…"** → **„Extrahieren"**.
- **Mac:** Doppelklick auf die ZIP-Datei.

Danach hast du einen ganz normalen Ordner mit den Dateien darin.

## 3. Öffnen und auswerten

1. Öffne den entpackten Ordner und mach einen Doppelklick auf die Datei
   **`START_HIER.html`** — sie öffnet sich in deinem Browser.
2. Klicke auf **„Datei auswählen"** und wähle deine **Logdatei** aus. Das ist die
   Besuchsliste deines Webservers, meist eine Datei mit der Endung `.log` oder `.txt`.
3. Klicke auf **„Jetzt auswerten"**.

Du siehst sofort deine meistbesuchten Seiten und — als Richtwert — wie viele Besucher du
im gewählten Zeitraum hattest.

### Was du im Ergebnis siehst

Ganz oben steht ein farbiges **Ampel-Signal** (Icon + kurzes Label) als schnelles
Gesamturteil — grün heißt „passt", gelb „kleine Lücke / Achtung", rot „hier solltest du
genauer hinschauen". Dazu gibt es bei Bedarf kurze Hinweis-Boxen.

Außerdem werden die wichtigsten Kennzahlen offen ausgewiesen, damit du nachvollziehen
kannst, wie die Zahlen zustande kommen:

- **Seitenaufrufe gesamt** und die meistbesuchten Seiten
- **geschätzte Besucher** (verschiedene Menschen, als Richtwert)
- **lesbare Zeilen**, also wie viele Logzeilen tatsächlich ausgewertet wurden
- **nicht verwendete Zeilen** samt Grund (z. B. Bot, Fehlerstatus, außerhalb des
  Zeitraums oder „Format nicht erkannt")

> **Sehr große Logdatei?** Kein Problem — die Datei wird zeilenweise gestreamt und mit
> Fortschrittsanzeige verarbeitet, der Browser friert nicht ein. Intern ist der
> Speicherverbrauch gedeckelt, sodass auch sehr große Dateien sicher durchlaufen. Nur bei
> vielen Millionen Zeilen kann es ein paar Sekunden dauern.
>
> Kaputte oder unleserliche Zeilen lassen das Tool nicht abstürzen — sie werden
> übersprungen und im Ergebnis als „nicht lesbar" bzw. „Format nicht erkannt" ausgewiesen.

---

## Du hast keine Logdatei?

Die Logdatei liegt auf dem Server, auf dem deine Website läuft — meist hat sie deine
IT-Abteilung oder deine Agentur.

Damit du nicht lange erklären musst, gibt es im Tool zwei fertige Vorlagen:
**„Text für deine IT/Agentur kopieren"** und **„Text für deinen Hoster kopieren"**. Ein
Klick kopiert den passenden Text — den schickst du an deine IT bzw. an deinen
Hoster-Support, und die Gegenseite weiß genau, welche Datei du brauchst und wie sie sie
exportiert.

**Erst mal ausprobieren?** Klicke im Tool auf **„Demo mit Beispieldaten starten"** —
dann siehst du an Beispielzahlen, wie das Ergebnis aussieht, ganz ohne eigene Datei.

### Welches Logformat passt?

ServerStory liest das **Combined Log Format** von Apache und Nginx — das ist das mit
Abstand gängigste Format, und genau danach fragen die fertigen Textvorlagen im Tool.

Liegt deine Website hinter einem Edge/CDN (z. B. Cloudflare, CloudFront, Fastly oder
Akamai) und exportierst du die Logs direkt dort, kommen sie oft im hauseigenen JSON-
oder TSV-Format — das erkennt ServerStory aktuell nicht direkt. Bitte in dem Fall deine
IT, deinen Hoster oder den CDN-Export auf das **Apache/Nginx Combined Log Format**
einzustellen, dann passt die Auswertung.

## Optional: mit Google Analytics vergleichen

Klappe im Tool den Bereich **„Optional: Mit Google Analytics vergleichen"** auf und
trag deine Google-Analytics-Zahlen ein. ServerStory stellt sie dann deinen echten
Server-Zahlen gegenüber und zeigt dir, ob Google Analytics weniger zählt — zum
Beispiel, weil Ad-Blocker oder abgelehnte Cookies einen Teil der Besuche verschlucken.

## Wie genau ist das?

ServerStory zeigt, was bei deinem Server **tatsächlich ankommt** — Cookie-Banner und
Ad-Blocker können das nicht verstecken. Zwei Dinge solltest du wissen:

**Aufrufe vs. Besucher.** Jeden Aufruf, der bei deinem Server ankommt, zählt er genau mit
— eine Logzeile pro Aufruf. (Ob *alle* Aufrufe ankommen, hängt vom Caching ab — dazu
gleich.) Wie viele *verschiedene Menschen* das waren (Besucher), steht dagegen nicht im
Log und ist eine Schätzung: Aufrufe werden per IP und Browser zu Personen zusammengefasst
(eine Person = mehrere Aufrufe, eine Firma = ein Besucher). Der Seiten-Vergleich
vergleicht nur **Aufrufe gegen Aufrufe** und braucht die Besucherzahl gar nicht.

**Abweichungen gehen in beide Richtungen.** Der Vergleich zeigt nicht „die Wahrheit",
sondern *wo* sich Server und Google Analytics unterscheiden:

- **Google Analytics zählt weniger als der Server** → meist Tracking-Verlust: abgelehnte
  Cookies, Ad-Blocker, nicht geladenes Skript.
- **Der Server zählt weniger als Google Analytics** → meist Caching/CDN: liegt deine
  Seite hinter Cloudflare, Fastly o. Ä. (oder im Browser-Cache), wird ein Teil der
  Aufrufe aus dem Cache ausgeliefert und erreicht das Origin-Log nie — das GA-Skript
  feuert trotzdem. (Auch Mehrfachzählung oder Bots können Google Analytics aufblähen.)

**Käufe** sind davon kaum betroffen: Eine Danke-Seite nach dem Kauf wird typischerweise
nicht gecacht (dynamisch, pro Bestellung) und erreicht den Server zuverlässig — der
Kauf-Vergleich bleibt belastbar.

**Bots.** Standardmäßig erkennt ServerStory Bots und Crawler an ihrem User-Agent
(Googlebot, Monitoring, Skript-Tools usw.) und filtert sie heraus. Bots, die sich gezielt
als echter Browser tarnen, lassen sich so nicht zu 100 % aussortieren — das gilt aber
genauso für Google Analytics. Wenn du den Verdacht auf viel getarnten Bot-Traffic hast,
aktiviere unter **„Erweiterte Filter"** den **strengen Bot-Filter**: Dann zählen nur noch
Zugriffe, die sich klar als Browser ausweisen. Das senkt das Bot-Risiko, kann aber auch
echte Besucher mit exotischen Browsern oder Clients ausschließen.

**Sitzt du hinter einem Proxy oder CDN (z. B. Cloudflare)?** Dann steht in der ersten
Spalte deiner Logzeile die IP des Proxys, nicht die deiner Besucher — die Besucherzahl
wäre dann unbrauchbar. ServerStory erkennt es, wenn auffällig viele Zugriffe von einer
einzigen oder einer internen IP-Adresse kommen, und weist dich darauf hin. Aktiviere in
dem Fall unter den erweiterten Filtern **„X-Forwarded-For"**, damit die echte Besucher-IP
verwendet wird. (Die Seitenaufrufe sind davon nie betroffen — nur die Besucherzahl.)

## Datenschutz

Die Auswertung passiert **ausschließlich in deinem Browser**. Es wird nichts
hochgeladen und nichts an einen Server gesendet. Angezeigt werden nur Summen — keine
IP-Adressen und keine Nutzerlisten.

**„Darf ich mir diese Daten überhaupt ansehen?" — In der Regel ja, wenn es deine
eigenen Logs sind.** Es sind die Logs deines **eigenen** Webservers; dafür bist du der
Verantwortliche im Sinne der DSGVO. Server-Logs (inklusive IP-Adressen) für den sicheren
Betrieb und für aggregierte Zugriffsstatistiken auszuwerten, lässt sich auf das
**berechtigte Interesse nach Art. 6 Abs. 1 lit. f DSGVO** stützen — das setzt eine
**Interessenabwägung** voraus (dein Statistik-/Sicherheitsinteresse gegen die Interessen
der Besucher) und dass du Server-Logs in deiner Datenschutzerklärung erwähnst. ServerStory
hilft dir dabei, datensparsam zu bleiben: Die Datei wird nur lokal verarbeitet, und
ausgegeben werden ausschließlich anonyme Summen — keine einzelnen IP-Adressen.

**Wertest du die Logs eines Kunden aus (z. B. als Agentur oder Freelancer)?** Dann ist
der Kunde der Verantwortliche und du verarbeitest die Daten in seinem Auftrag — dafür
braucht ihr einen **Auftragsverarbeitungsvertrag nach Art. 28 DSGVO**. Dass ServerStory
rein lokal läuft und nichts überträgt, erleichtert diese Vereinbarung, ersetzt sie aber nicht.

Auch die optionalen erweiterten Filter ändern daran nichts: Wenn du „X-Forwarded-For"
aktivierst, dient die darin enthaltene Besucher-IP nur lokal im Browser zum
Zusammenfassen von Besuchen — übertragen oder ausgegeben wird sie nicht.

Halte dich an die übliche Log-Hygiene: kurze Aufbewahrungsfrist, Zugriff begrenzen,
Server-Logs in der Datenschutzerklärung erwähnen und IP-Adressen nach Möglichkeit kürzen.
Das ist keine Rechtsberatung.

## Für technisch Interessierte: Aufbau

ServerStory ist eine **einzige, abhängigkeitsfreie `index.html`** — die komplette Logik
(HTML, CSS, JavaScript) steckt in dieser Datei. Kein Build-Schritt, kein npm, keine
externen Bibliotheken zur Laufzeit. **`START_HIER.html`** ist nur der freundliche
Einstiegspunkt und leitet auf `index.html` weiter.

Es gibt **keine Server-Komponente**: Die Logdatei wird ausschließlich im Browser
verarbeitet (Streaming Zeile für Zeile), nichts wird hochgeladen oder an einen Server
gesendet. Die Logzeilen werden gegen das Apache/Nginx Combined Log Format geparst;
unleserliche Zeilen werden robust übersprungen statt das Tool abstürzen zu lassen.

Tests liegen unter **`tests/`** und prüfen die echte, unveränderte Parser-/Aggregator-
Logik aus `index.html` (inklusive kaputter und unleserlicher Zeilen) gegen feste
Beispiel-Logs in `tests/fixtures/`.

## Lizenz

MIT — siehe [`LICENSE`](LICENSE).
