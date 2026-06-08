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

> **Sehr große Logdatei?** Kein Problem — die Datei wird zeilenweise mit Fortschritts-
> anzeige verarbeitet und friert den Browser nicht ein. Nur bei vielen Millionen Zeilen
> kann es ein paar Sekunden dauern.

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

## Datenschutz

Die Auswertung passiert **ausschließlich in deinem Browser**. Es wird nichts
hochgeladen und nichts an einen Server gesendet. Angezeigt werden nur Summen — keine
IP-Adressen und keine Nutzerlisten.

**„Darf ich mir diese Daten überhaupt ansehen?" — Ja.** Es sind die Logs deines
**eigenen** Webservers; dafür bist du der Verantwortliche im Sinne der DSGVO. Server-Logs
(inklusive IP-Adressen) für den sicheren Betrieb und für aggregierte Zugriffsstatistiken
auszuwerten, ist durch dein **berechtigtes Interesse nach Art. 6 Abs. 1 lit. f DSGVO**
gedeckt. ServerStory geht dabei besonders datensparsam vor: Die Datei wird nur lokal
verarbeitet, und ausgegeben werden ausschließlich anonyme Summen — keine einzelnen
IP-Adressen.

Auch die optionalen erweiterten Filter ändern daran nichts: Wenn du „X-Forwarded-For"
aktivierst, dient die darin enthaltene Besucher-IP nur lokal im Browser zum
Zusammenfassen von Besuchen — übertragen oder ausgegeben wird sie nicht.

Halte dich an die übliche Log-Hygiene: kurze Aufbewahrungsfrist, Zugriff begrenzen,
Server-Logs in der Datenschutzerklärung erwähnen und IP-Adressen nach Möglichkeit kürzen.
Das ist keine Rechtsberatung.

## Lizenz

MIT — siehe [`LICENSE`](LICENSE).
