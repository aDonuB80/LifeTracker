# Lifetrack – private Life-Tracking-PWA (Version 0.4.0)

Offline-Web-App fürs iPhone: Ernährung mit eigener Lebensmitteldatenbank und Phasen, Gewicht mit Mittelwerten und Prognose, Sport (Laufen, Bouldern, Gym), Schlaf, Stimmung und Stress, Familie & Freunde, Tagebuch, Termine und Todos (auch wöchentlich/monatlich wiederkehrend), ⭐ sowie Wochenübersicht und Trends. Alle Daten bleiben auf dem iPhone (IndexedDB). Es gibt kein Backend, kein Tracking und keine externen Abhängigkeiten.

## Dateien
```
index.html  manifest.webmanifest  service-worker.js
css/app.css
js/  app.js (Start/Navigation) · db.js (IndexedDB + Migrationen) · dates.js (Europe/Berlin)
     stats.js (Rechnen, Theil-Sen) · ui.js (Sheets/Toasts) · state.js
     food.js · body.js · sport.js · social.js · diary.js · planner.js · today.js · analysis.js · charts.js · backup.js · settings.js
icons/  apple-touch-icon.png, icon-192/512, maskable, star.svg
```
Es gibt keinen Build-Schritt. Die Dateien werden so hochgeladen, wie sie sind.

## 1. Hosting auf GitHub Pages (ohne Mac, ohne Kommandozeile)
1. ZIP auf dem PC entpacken.
2. Auf github.com ein Konto anlegen. Dann **New repository** wählen, als Name z. B. `lifetrack`, Sichtbarkeit **Public**, und **Create repository** klicken.
   *GitHub Pages ist für private Repos kostenpflichtig. Öffentlich ist nur der Code, deine Daten liegen ausschließlich auf dem iPhone.*
3. Im leeren Repo auf **„uploading an existing file"** klicken und den **Inhalt** des entpackten Ordners hineinziehen, also `index.html`, `manifest.webmanifest`, `service-worker.js` und die Ordner `css`, `js` und `icons`. In Chrome oder Edge kann man ganze Ordner ziehen. Danach **Commit changes** klicken.
4. Unter **Settings → Pages → Build and deployment** als Source **Deploy from a branch** wählen, Branch `main` und Ordner `/ (root)`, dann **Save**.
5. Nach 1–2 Minuten erscheint dort die Adresse `https://<dein-name>.github.io/lifetrack/`.

## 2. Installation auf dem iPhone
1. Die Adresse in **Safari** öffnen.
2. Auf **Teilen** tippen, dann **Zum Home-Bildschirm**. Falls der Schalter „Als Web-App öffnen" angezeigt wird, muss er an sein. Dann **Hinzufügen**.
3. Die App **vom Home-Bildschirm** starten. Beim ersten Start wird alles für den Offline-Betrieb gespeichert.
4. **Wichtig:** Daten nur in der Home-Bildschirm-App eintragen. Der Safari-Tab hat einen eigenen, getrennten Speicher. Die App zeigt im Tab einen Warnhinweis.

## 3. Offline-Test (Flugmodus)
1. Die App einmal online öffnen und kurz warten.
2. Flugmodus einschalten.
3. Die App im App-Umschalter ganz schließen (nach oben wischen).
4. Die App neu öffnen. Sie muss vollständig laden. Einen Eintrag anlegen, die App schließen und wieder öffnen: Der Eintrag muss noch da sein.

## 4. Updates einspielen
1. Die geänderten Dateien im Repo hochladen (gleicher Upload-Weg, vorhandene Dateien werden überschrieben).
2. **In `service-worker.js` die Zeile `VERSION` hochzählen**, z. B. `lifetrack-v0.2.1`. Neue JS-Dateien zusätzlich in die Liste `FILES` eintragen. Ohne diesen Schritt bekommt das iPhone das Update nicht.
3. Die App online öffnen. Es erscheint „Neue Version verfügbar", dann auf **Aktualisieren** tippen. Alternativ in den Einstellungen „Nach Update suchen" wählen.

## 5. Backup
- Unter **Einstellungen (⚙️ oben auf „Heute") → Exportieren / Teilen** öffnet sich das iOS-Teilen-Menü. Dort **„In Dateien sichern"** wählen, am besten in iCloud Drive.
- **Importieren** prüft die Datei vollständig, bevor etwas geschrieben wird. Danach hast du zwei Möglichkeiten:
  - **Zusammenführen:** Vorhandene Daten bleiben. Gibt es einen Eintrag in beiden Datenbeständen, gewinnt die neuere Version.
  - **Alles ersetzen:** Alle Daten werden durch das Backup ersetzt.
- Wenn der letzte Export länger zurückliegt als eingestellt (Standard 14 Tage), erscheint auf „Heute" eine Erinnerung.

## 6. Test-Checkliste (Offline-Betrieb und Datenerhalt)
- [ ] Erster Start online. Danach Flugmodus, App beenden, neu starten: App lädt.
- [ ] Offline Essen anlegen („Neu anlegen: …"), Gewicht, Lauf, Boulder, Gym und Schlaf eintragen.
- [ ] App beenden und iPhone neu starten: Alle Einträge sind noch da.
- [ ] Einstellungen → „Dauerhafter Speicher: ja ✓". Steht dort „nein", sind regelmäßige Backups umso wichtiger.
- [ ] Export → In Dateien sichern. Die Datei ist in der Dateien-App sichtbar und einige KB groß.
- [ ] Datei-Import mit „Zusammenführen" auf demselben Gerät: Meldung „0 neu, 0 aktualisiert", es entstehen keine Duplikate.
- [ ] **Wiederherstellung:** App vom Home-Bildschirm löschen (damit sind alle Daten weg), neu installieren, Backup importieren. Alles ist wieder da, inklusive Lebensmitteldatenbank, Phasen und Boulder-Skalen.
- [ ] Eine manipulierte Datei (z. B. ein Datum gelöscht) wird mit Fehlerliste abgelehnt und es wird nichts verändert.
- [ ] Ein Eintrag um 01:30 Uhr zählt zum Vortag (Tageswechsel 04:00 Uhr).
- [ ] Löschen, dann „Rückgängig": Der Eintrag ist wieder da.
- [ ] Ereignis mit neuer Person anlegen. Beim nächsten Ereignis erscheinen Typ und Person als Vorschlag.
- [ ] Im Export (JSON) taucht ⭐ nur unter dem Schlüssel `sz` auf, ohne Klartext.

## 7. iOS-Grenzen und wie die App damit umgeht
| Risiko | Umgang |
|---|---|
| **App löschen = Daten weg** (eigener Speicher pro Web-App) | Backup-Erinnerung, Export ins Teilen-Menü, Wiederherstellungstest in der Checkliste |
| **Speicher-Eviction:** Safari kann bei Speichermangel oder langer Nichtnutzung Daten löschen | `navigator.storage.persist()` beim Start, Status in den Einstellungen. Installierte Home-Bildschirm-Apps sind von der 7-Tage-Löschregel für Websites ausgenommen. Restrisiko → Backups |
| **Safari-Tab und Home-App getrennt** | Warnbanner im Tab |
| **Keine Push-Erinnerungen offline** | Backup-Erinnerung, heutige Termine und fällige Todos erscheinen nur beim Öffnen der App auf „Heute“. Wer Alarme braucht, trägt wichtige Termine zusätzlich im iPhone-Kalender ein |
| **Kein Zugriff auf Apple Health** | Gewicht, Schlaf und Läufe werden manuell erfasst |
| **Pausen-Timer** | Keine Vibration in Safari. Der Ton ist abhängig vom Stummschalter. Der Timer läuft nicht im Hintergrund weiter, rechnet aber nach Rückkehr korrekt nach |
| **Tastatur über Bottom-Sheets** | Die Sheets passen ihre Höhe an die Tastatur an (visualViewport). Bitte auf dem Gerät testen |

## Bewusste Abweichungen von der Spezifikation
- **Undo:** Der Eintrag wird sofort gelöscht und „Rückgängig" schreibt ihn wieder zurück. Das ist robuster, wenn iOS die App im Moment des Löschens beendet.
- **„Alles ersetzen":** Es gibt keinen automatischen Export davor, weil das Teilen-Menü den Ablauf unterbrechen würde. Stattdessen gibt es den Button „Vorher aktuelles Backup exportieren" und eine doppelte Bestätigung.
- **⭐ ohne PIN** (wie gewünscht). Der Speicher- und Export-Schlüssel heißt neutral `sz`.
- **Boulder-Grade sind skalenübergreifend nicht vergleichbar.** Die Auswertung zeigt deshalb pro Skala eine eigene Grad-Verteilung.
- **Zeitachsen:** Bis 1 Jahr wird pro Woche (KW-Nummer) aggregiert, darüber pro Monat. Bei „Befinden“ ist Woche/Monat wählbar.

## Persönliche Daten gehören nur in die JSON-Datei
Der Programmcode liegt öffentlich auf GitHub und enthält deshalb keine persönlichen Bezüge: keine Namen, keine eigenen Lebensmittel, Hallen oder Skalen und keine Beispieltexte daraus. Vorbelegt sind nur die allgemeinen Boulder-Skalen Fb/Font und V-Skala.
Alles Persönliche kommt per Import-Datei aufs iPhone, auch eigene Boulder-Skalen und die Zuordnung Halle → Skala:
```json
{ "app": "lifetrack", "schemaVersion": 1, "data": {},
  "settings": { "gradeScales": [ { "id": "meine-halle", "name": "…", "grades": ["…", "…"] } ],
                "hallScale": { "…": "meine-halle" } } }
```
Beim Import **„Zusammenführen"** wählen. „Alles ersetzen" würde mit so einer Datei ohne Daten alle Einträge löschen. Die Skalen lassen sich alternativ auch direkt in der App unter Einstellungen anlegen.

## Planer: Termine und Todos
- Tab **Planer**, Einstellungen über das ⚙️ oben auf „Heute“. Damit bleibt die Tab-Leiste bei sechs Einträgen.
- **Wiederkehrende Todos:** Beim Abhaken springt das Todo auf den nächsten Termin nach dem späteren von Fälligkeit und heute. Verpasste Wiederholungen stauen sich nicht auf, die Erledigungen stehen in der Historie. Monatlich am 29.–31. bedeutet in kürzeren Monaten: am letzten Tag.
- „Heute“ zeigt die Termine des Tages und alle fälligen oder überfälligen Todos, mit Abhaken direkt dort.

## Technische Notizen
- Datumslogik ist fest auf Europe/Berlin über `Intl` ausgelegt, unabhängig von der Geräte-Zeitzone. Tage werden als `YYYY-MM-DD` gespeichert, Zeitpunkte als epoch-ms. Das ist sommerzeitfest und getestet.
- Gewichtsprognose: Theil-Sen über 14 oder 28 Tage, Band aus dem 10.–90. Perzentil der Paarsteigungen. Unter 7 Messtagen gibt es keine Prognose.
- Schema-Version 2 (v2 ergänzt die Stores `appointments` und `todos`; Migration beim ersten Start, getestet von 0.3.0 → 0.4.0). Exporte mit Schema 1 lassen sich weiter importieren. Neue Felder kommen als `MIGRATIONS[n]` in `db.js` dazu, für alte Exporte als `RECORD_MIGRATIONS[n]`.
- Performance-Test mit 3 Jahren Daten (9 900 Essenseinträge, 1 100 Gewichte): Jeder Tab baut sich in unter 200 ms auf (Desktop-Chrome), der Export ist ca. 3 MB groß.
