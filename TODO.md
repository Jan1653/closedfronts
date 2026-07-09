# ClosedFronts – TODO / Roadmap

Detaillierte Feature-Liste. Querschnittsregel für ALLES: **muss auch auf der
Handy-/Mobile-UI funktionieren.**

---

## 0. Aktuelles Feedback-Backlog (Stand: neustes Sprachfeedback)

Alles aus der letzten Sprachnachricht, damit nichts vergessen wird.

### 0.1 Eigene Karten-Icons (Ölpumpe / Wand / Zollstation) — ERLEDIGT

- [x] **Bar-Icons als Karten-Icon** (Öltropfen/Wand/Zoll-Tor) — auch beim
      Platzieren (Ghost zeigt das richtige Icon).
- [x] **Abhängigkeitsfreier PNG-Encoder** (`scripts/gen-icon-atlas.mjs`, Node
      `zlib`): Atlas 384×64 → 576×64 (6 → 9 Spalten), ASCII-validiert.
- [x] **StructurePass** auf 9 Spalten, Platzhalter entfernt; **frag-Shader**
      Hintergrundformen (Öl=Kreis, Wand=Quadrat, Zoll=Pentagon);
      **render-settings.json** `shapes`-Einträge ergänzt.
- [x] **Behebt den Hover-Cross-Highlight** (getrennte Atlas-Spalten).

### 0.2 „Explosion" der Zollstation beim Platzieren — ERLEDIGT

- [x] **Echte Ursache gefunden & behoben:** `PlayerExecution.tick()` löscht JEDE
      Struktur, deren Kachel keinen Spieler-Besitzer hat — Wasser hat nie einen,
      also wurde Zollstation/See-Ölpumpe jeden Tick gelöscht (= die „Explosion").
      Fix: Wasser-Strukturen sind von dieser Reklamation ausgenommen. Regressions-
      test in `WaterTollStation.test.ts` (läuft mit aktiver PlayerExecution).

### 0.3 Hotkey-Reihenfolge + Beschriftung — ERLEDIGT

- [x] Bar-Reihenfolge **1…0**, dann **Alt 1 / Alt 2 / Alt 3** (Zusatzbauten am Ende).
- [x] Kürzel-Hinweis auf jedem Button (inkl. „Alt 1/2/3") + im Tooltip.
- [x] Alt statt Strg (Browser reserviert Strg+Zahl für Tab-Wechsel).

### 0.4 Öl-Verbrauch beim Vergrößern in die Wildnis — ERLEDIGT

- [x] **Expansion kostet Öl:** `oilExpansionCostPerTile` (= 5) zieht Öl pro neu
      eroberter Kachel ab (Delta seit letztem Tick; lazy Baseline, damit
      Spawn-/Setup-Land nicht belastet wird). Aktives Erobern drainiert jetzt den
      Tank zusätzlich zum passiven Größen-Verbrauch. Getestet.

### 0.5 Wände dürfen sich NICHT stapeln — ERLEDIGT

- [x] **Mindestabstand** (`wallMinSpacing` = 3): `wallSpawn` lehnt zu nahe
      Platzierung ab (kein Stapeln).
- [x] **Umkreis-Auto-Verbindung** (`wallConnectRange` = 25): neue Wand nahe
      einer eigenen Wand baut automatisch eine **kostenlose Wand-Linie**
      (Bresenham) dazwischen; Segmente kaskadieren nicht. Getestet.

### 0.6 Verteidigungsposten-Balancing — ERLEDIGT

- [x] **Halb so schnell** auf Level 1 (feuert jede 2. Tick).
- [x] **Schneller + stärker pro Level** (kürzeres Intervall + mehr Granaten/Burst).
- [x] Radius wächst beim Stacken (beibehalten).
- [x] **Teurer** (150k→750k statt 100k→500k).

---

### 0.7 Diese Session zusätzlich erledigt

- [x] **Öl-Vorkommen als unregelmäßige Blobs** statt Einzelpixel: gemeinsame,
      deterministische Funktion `src/core/game/OilDeposits.ts` (`isOilDepositAt`),
      von `Config.isOilDeposit` UND dem Client-Overlay genutzt (kein Drift).
      Test in `OilEconomy.test.ts` beweist Cluster-Bildung (>90 % Nachbarschaft).
- [x] **Wände wie Zugstrecken**: neuer `WallPass` (GPU) zeichnet Wände als kräftige,
      gesättigte Eigenfarb-Blöcke (statt Icon), ~1,4 Kacheln groß → Wandketten
      verschmelzen zur Linie. `StructurePass` überspringt Wände. Settings in
      `render-settings.json` → `wall`.
- [x] **Öl-Map-Overlay** (`OilDepositPass`): zeigt Deposit-Blobs als öligen Tint;
      Toggle über die **Öl-Anzeige im ControlPanel** (klickbar, Handy+PC) **und**
      Taste **`O`**. Live verifiziert (Blobs sichtbar, Shader kompilieren).
- [x] **Kriegsschiff kapert Ölpumpen + Zollstationen** (geteilter
      `WarshipCaptureTracker`); Kapern startet den Krieg (beide Seiten feindlich),
      auch wenn man vorher neutral war. `OilPumpExecution` neu; Tests in
      `OilEconomy.test.ts`.

### 0.8 Feedback-Backlog (Sprachnachricht 2) — NEU, offen

**Menü / Seite:**

- [ ] **Logo klickbar → Startseite**: Klick auf das „ClosedFronts"-Logo oben links
      führt zurück ins Hauptmenü.
- [ ] **Versions-Anzeige entfernen** (das „v-XXX"/Versions-Ding).
- [x] **Lobby: Namensänderung** in der Lobby (Desktop **und** Handy) — ERLEDIGT.
      Neue Komponente `<lobby-name-editor>` in Host- + Join-Modal („Dein Name" +
      Speichern). Klick löst ein `lobby-rename`-DOM-Event aus; Main persistiert den
      Namen und ruft `lobbyHandle.updateIdentity`, was per **Reconnect** einen
      frischen Join sendet → Server nimmt den Reconnect-Pfad (Zensur +
      Identity-Update vor Spielstart) und broadcastet die Lobby neu. Live
      verifiziert (Name ändert sich in der Spielerliste). DE+EN-Strings ergänzt.
- [ ] **Clans**: Clan-Erstellung funktioniert nicht — Erstellen ermöglichen;
      Leaderboard-/Clans-Flow prüfen (kann man überhaupt einen Clan anlegen?).

**Übersetzungen (Priorität: Deutsch + Englisch VOLLSTÄNDIG; andere Sprachen später):**

- [x] **Regel geklärt:** DE + EN werden im Repo manuell gepflegt (de.json + en.json
      synchron), Crowdin nur für andere Sprachen — CLAUDE.md entsprechend angepasst.
- [ ] Alle sichtbaren Texte über `translateText` + `en.json`/`de.json`; **DE + EN
      komplett** (großer Audit, weiterhin offen).
- [x] „Aktive Einstellungen": **„Boot"** war auf DE nicht übersetzt (fehlte im
      `unit_type`-Block der de.json) → `boat/oil_pump/wall/water_toll_station` ergänzt.
- [x] Neue Bauten (**Ölpumpe, Wand, Zollstation**) **erscheinen** jetzt in „Aktive
      Einstellungen" (`unitOptions`) und sind DE+EN übersetzt.

**Öl / Ölpumpen-Map:**

- [x] **Öl-Map schon in der Spawn-Phase** öffnen (für bessere Startpunkt-Wahl):
      Öl-Toggle-Button in der oberen Steuerleiste (`GameRightSidebar`, in der
      Spawn-Phase sichtbar, Handy+PC) + Taste `O`. Live verifiziert.

**Zollstation — Mechanik-Redesign (ersetzt die sofortige Gutschrift) — ERLEDIGT:**

- [x] Maut wird **NICHT sofort** beim Durchfahren gutgeschrieben, sondern
      **sammelt sich an der Station** (`pendingGold`).
  - [x] Ohne **Hafen** wird nichts kassiert (Einsammeln braucht einen Hafen am
        Wasser).
  - [x] Durchfahrende **feindliche/neutrale** Schiffe zahlen in den Stations-Topf.
  - [x] Ein **Einsammel-Schiff** (Transportschiff) fährt vom **eigenen Hafen** zur
        Station und **zurück zum selben Hafen**; erst bei **Ankunft am Hafen** wird
        das geladene Geld **eingelöst**. Immer nur ein Schiff pro Station gleichzeitig.
  - [x] **Kriegsschiffe** können den Weg abschneiden → wird das Einsammel-Schiff
        versenkt/gekapert, ist das geladene Geld **verloren**.
  - [x] Schiff ist derselbe **Transportschiff-Typ** (mit Trail) wie das Expansions-
        Boot, kommt aber **aus dem Hafen**.
  - [ ] Live gegenprüfen (Nutzer testet): Einsammel-Rundtrip + Abfangen + Verlust.

**Sea-Build (Zollstation/Ölpumpe im Meer):**

- [ ] Bau-Schiff kommt **aus dem Hafen** (Hafen nötig), gleicher Schiffstyp/Optik
      (Trail/Strahl) wie das Expansions-Transportschiff. (SeaBuildExecution startet
      bereits am nächsten Hafen — Optik/Trail-Konsistenz nachziehen.)

**Verteidigungsposten:**

- [ ] Umkreis-/Granaten-Einnahme darf **kein neutrales** Gegner-Land einnehmen,
      solange man **nicht im Krieg** mit dem Besitzer ist (nur Wildnis + echte
      Kriegsgegner).

**KI (alle Schwierigkeiten, angemessen skaliert):**

- [ ] KI baut/nutzt **Ölpumpen** (Öl-Ökonomie verstehen).
- [ ] KI baut **Zollstationen**, **Wände**, **Verteidigungsposten** sinnvoll und
      versteht deren Funktion.
- [ ] KI versteht **Krieg** inkl. der neuen Kaper-Mechanik (Kriegsschiff).

**Test-Hinweis:**

- [ ] Eigene Live-Tests **ohne Bots und ohne Nations** starten (sonst sofortiger Tod).

**Workflow:**

- [ ] Änderungen direkt nach **`main`** committen/pushen (Nutzerwunsch). Achtung:
      jeder Push wipet laufende Spiele (Auto-Deploy) — siehe [[closedfronts-deployment]].

---

## 1. Water Toll Station (Zollstation)

- [x] Core: Typ, Konfiguration, Platzierung auf Wasser zwischen zwei Landmassen
- [x] Kapern durch feindliches Kampfschiff (getestet)
- [x] Maut kassieren: Feinde & Neutrale zahlen, eigene/verbündete frei (getestet)
- [x] Build-Menü-Eintrag + Radius-Vorschau + auf Karte sichtbar (Platzhalter)
- [x] Überlebt den echten Baupfad in der Simulation (Regressionstest)
- [x] **Eigenes Icon** (Zoll-Tor) statt Hafen-Platzhalter → 0.1
- [x] **Grüne Vorschau, wenn gültig:** Umkreis-Ring wird grün bei gültig, rot bei
      ungültig (RangeCirclePass, nach `canBuild`).
- [x] **Verkettung:** Ankerpunkt kann Landmasse **oder** andere Zollstation im
      Umkreis sein (`tollStationConnections`); so über lange Strecken bauen
      (getestet).
- [ ] Die zwei „Straßen"-Verbindungslinien zeichnen (Client)
- [x] **Sea-Build:** Zollstation wird per Truppen-Transportschiff im Meer gebaut
      (`SeaBuildExecution`): Schiff fährt vom Hafen zum Ziel, baut nach Bauzeit;
      wird es versenkt → kein Bau, nichts berechnet. Getestet.
- [ ] Umgehung im Boot-Pathfinding (Aufpreis-Ebene im Wasser-A\*)
- [ ] Mobile-UI geprüft

---

## 2. Verteidigungsposten (Defense Post)

- [x] Kosten verdoppelt (Basis)
- [x] Upgradebar/stackbar: Radius wächst pro Level (30 → 60, getestet)
- [x] Pixel-Sperrfeuer nimmt Feind-Kacheln UND Wildnis im Radius ein (getestet)
- [ ] **Balancing (0.6):** halb so schnell (Basis), schneller pro Level, teurer
- [ ] Pixel-Granaten sichtbar fliegen lassen (Client-Optik)
- [ ] Mobile-UI geprüft

---

## 3. Wände (Walls)

- [x] Baubar + auf Karte sichtbar (Platzhalter-Icon)
- [x] Übernehmbar (wer die Kachel hält, bekommt die Wand)
- [x] Sehr schwer zu durchbrechen (50× Angriffskosten, getestet)
- [x] Brechbar durch Verteidigungsposten-Granaten oder Bombe
- [x] **Eigenes Icon** (Mauerwerk) statt Platzhalter
- [x] **Kein Stapeln, Mindestabstand** (`wallMinSpacing`)
- [x] **Umkreis + Auto-Verbindung** zu naher Wand als kostenlose Wand-Linie
- [ ] Timer über der Wand beim Durchbrechen (Client)
- [x] **„Nur brechen, wenn kein Weg drumherum":** Angriffe deferieren Wand-Kacheln
      in der Eroberungs-Priorität (`AttackExecution`) → gehen zuerst drumherum,
      brechen die Wand erst, wenn kein anderer Rand frei ist. Getestet. (Wirkt bei
      Verteidigern ≥100 Kacheln; kleinere fallen ohnehin per Dead-Defender-Shortcut.)
- [ ] „…sonst Boot senden" (amphibische KI-Umgehung) — Nachtrag
- [ ] Mobile-UI geprüft

---

## 4. Ölpumpen (Oil Pumps) + Öl-Ökonomie

- [x] Gebäude „Ölpumpe", Öl-Ressource, Verbrauch ∝ Größe, Startvorrat + Deckel
- [x] Produktion 250/Pumpe (deckt ~50k Kacheln); Baupfad erzeugt gezählte Pumpe
      (getestet)
- [x] Leerer Tank verlangsamt: Transport-/Handelsschiffe, Landangriffe, Züge
- [x] Faktor auf **Kampfschiffe**: Bewegungs-Gate in `WarshipExecution.moveWarship`
      (nur bei leerem Tank; Feuern bleibt unbeeinflusst; getestet)
- [x] Öl-Anzeige im HUD
- [ ] **Eigenes Icon** statt Fabrik-Platzhalter → siehe 0.1
- [x] **Öl-Kosten beim Vergrößern** (`oilExpansionCostPerTile`, 0.4)
- [x] Nur an **validen Öl-Vorkommen** platzierbar (`isOilDeposit`, deterministischer
      Karten-Hash; grün/rot-Vorschau-Ring; getestet)
- [ ] Öl-Vorkommen sichtbar overlayen (Client-Politur, damit man sie leichter findet)
- [x] **Meer-Ölpumpen:** Ölpumpe an Meer-Vorkommen per Sea-Build (Transportschiff),
      `oilPumpSpawn` erlaubt Wasser-Vorkommen ohne Land-Besitz; produziert wie eine
      Land-Pumpe. Getestet.
- [x] Mehrere Ölpumpen am selben Ort möglich
- [x] Bombe → Explosion in Pump-Radius-Größe (getestet)
- [ ] Mobile-UI geprüft

---

## 5. Input / UX

- [x] Zusatzbauten in der Schnellbau-Leiste (Wand/Ölpumpe/Zollstation)
- [x] Alt+1/2/3 wählt die Zusatzbauten
- [x] Shift+Mausrad bei aktivem Ghost = Stückzahl 1–25, gestapelt platzieren
- [x] Leiste bricht um (flex-wrap) statt abgeschnitten zu werden
- [x] **Hotkey-Reihenfolge + Beschriftung** (0.3)
- [x] **Mobile-Lösung für Mehrfachbau:** Mengen-Stepper (− ×N +) im Baumenü,
      setzt `buildQuantity`; `sendBuildOrUpgrade` platziert N (gestapelt).
      Touch-tauglich, kein Shift+Rad nötig.
- [x] Alle neuen Bau-Buttons erscheinen im Handy-Baumenü (kommt aus `buildTable`
      + `buildableUnits`, enthält alle 3) — per Code bestätigt; **live noch gegen-
      prüfen.**

---

## 6. Querschnitt / Infrastruktur

- [x] Klickbare Start-Datei (`start-game.bat`)
- [ ] Jedes Feature explizit auf **Mobile-UI** verifizieren
- [ ] Icons-Encoder-Skript als Tool ablegen (reproduzierbar)

---

## 7. Map-Editor (GANZ UNTEN — erst wenn sonst nichts mehr offen ist)

Nur umsetzen, wenn die restliche TODO leer ist **und** explizit „mach die TODO"
gesagt wird. Hier die vollständige Spezifikation, damit nichts verloren geht.

**Hauptmenü / Community:**

- [ ] Neuer Button **„Map erstellen"** und ein neuer **„Maps"-Reiter** im Hauptmenü.
- [ ] Startseite zeigt die **meistgelikten** Community-Maps.
- [ ] **Filter** im Maps-Reiter: „Neueste", „Beliebteste" (meistgelikt), evtl. „Meine".
- [ ] Mit Account: Maps **liken**.
- [ ] Auf einer Community-Map ein **„+"** drücken → landet in der eigenen Auswahl
      unter **„Custom Maps"** (im Solo-/Lobby-Map-Picker auswählbar).

**Editor-Funktionen:**

- [ ] **Terrain-Tools**: Land / Wasser / Gebirge / … setzen (Pinsel, Radierer,
      Füllen, evtl. Höhen/Terrain-Typen wie im bestehenden Map-Format).
- [ ] **Größe einstellbar** mit **fester Min-/Max-Grenze** (Grenzen definieren).
- [ ] Map **benennen**.
- [ ] Speichern **privat** ODER **veröffentlichen** — beides an den **Account**
      gebunden/verlinkt (private Maps erscheinen nur beim Ersteller).

**Reale Karten importieren (aus Geodaten eine Map generieren):**

- [ ] Im Editor gibt es eine **echte Weltkarte**; man klickt/zieht einen **Bereich**
      (z. B. die eigene Heimatstadt) und daraus wird eine **spielbare Map generiert**.
- [ ] Daten aus **öffentlich/offen lizenzierten** Kartenquellen ziehen
      (**OpenStreetMap**, Natural Earth, o. Ä.). **NICHT Google** — deren Daten sind
      nicht offen lizenziert und passen nicht zur AGPL/CC-BY-SA-Linie des Projekts
      (siehe [[closedfronts-project]]).
- [ ] **Terrain aus der Realität ableiten**: Land/Wasser, und der Terrain-**Typ**
      richtet sich nach dem, was dort wirklich ist (z. B. Wüste → Wüste, Gebirge →
      Gebirge, Wald/Ebene entsprechend).
- [ ] **Flüsse müssen funktionieren** und **durchgehend** sein: ein in der Realität
      zusammenhängender Fluss darf beim Rastern **nicht mittendrin zerrissen** werden.
      Lieber den Fluss **durchziehen** (Lücken schließen / verbinden), als einzelne
      Pixel mitten in den Fluss zu setzen. **Fluss-Kontinuität hat Priorität.**
- [ ] **Entrauschen** (viele einzelne Streu-Pixel vermeiden), ABER am Anfang lieber
      **eine solide Fläche/„ein Schweiß"** erzeugen, statt zu aggressiv Pixel zu
      vermeiden. Priorität: erst grob & zusammenhängend, dann verfeinern — Flüsse
      aber von Anfang an durchgehend.
- [ ] Ergebnis ist eine normale Custom-Map (benennen, privat/öffentlich, „+" in die
      eigene Auswahl) wie oben.

**Technik (bei Umsetzung klären):**

- [ ] Speicherformat kompatibel zum bestehenden Terrain-Loader
      (`TerrainMapFileLoader` / bestehendes bin-Format) halten.
- [ ] Backend: `localapi`-Endpunkte für Maps (CRUD), Likes, Listing/Filter —
      siehe [[closedfronts-localapi]].
- [ ] Geodaten-Import: Quelle klären (OSM-Extrakte/Overpass für Küstenlinie +
      Gewässer/`waterway`, Landnutzung/`natural=desert|wood|…`; ggf. Höhen aus
      offenem DEM). Rasterung ins Spiel-Grid: Wasser/Land-Maske, Terrain-Typ pro
      Kachel, **Fluss-Skelett zuerst als durchgehende 1-Kachel-Linie brennen**
      (Fluss-Segmente verbinden), dann Landnutzung füllen, dann kleine Insel-/
      Streu-Pixel glätten (Morphologie: open/close) — Flüsse dabei NICHT auftrennen.
- [ ] Lizenz/Attribution der Geodatenquelle beachten (OSM = ODbL → Namensnennung).
- [ ] Mobile-UI berücksichtigen (Querschnittsregel).
