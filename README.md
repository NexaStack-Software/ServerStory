# ServerStory

Sieh in wenigen Minuten, was deine Website laut deinen Server-Logs **wirklich** an
Besuchern und Seitenaufrufen hatte — direkt aus der Quelle, ohne Cookies und ohne
Tracking-Tool. Optional kannst du die Zahlen direkt mit Google Analytics vergleichen
und siehst sofort, ob Google Analytics weniger zählt als die Realität.

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

Du siehst sofort deine meistbesuchten Seiten und wie viele Besucher du im gewählten
Zeitraum wirklich hattest.

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
