# ClosedFronts – TODO / Roadmap

Detaillierte Feature-Liste. Querschnittsregel für ALLES: **muss auch auf der
Handy-/Mobile-UI funktionieren.**

---

## ⭐ Offene Punkte (Kurzübersicht)

Was noch aussteht (Details in den jeweiligen Abschnitten unten):

Nur noch live gegenzuprüfen (Logik steht, du testest im Spiel):

- [ ] **Random-Spawn** in echter Multiplayer-Lobby (fehlender Startpunkt → zufällig).
- [ ] **Zollstation-Rundtrip** (Einsammeln + Abfangen + Verlust).
- [ ] **KI-Zollstationen** an Meerengen (selten, esp. Easy) — im Spiel beobachten.

Noch offen (echte Arbeit):

- [ ] **Schiffe umgehen Zollstationen** (Pathfinding), außer der Umweg ist zu
      lang → dann durchfahren + zahlen. (Core-Pathfinding, größer.)
- [ ] **Map-Editor** (ganz unten) + **Reale-Karten-Import** aus Geodaten.

- [x] **Zollstation-Verbindungslinien gerendert**: neuer `TollConnectionPass`
      zeichnet je Station zwei bernsteinfarbene Seil-/Straßen-Linien übers Meer
      zu den Ankern. Client berechnet die Anker selbst (`tollStationConnections`
      via minimales `TollConnGame`-Interface; GameView erfüllt es), gecacht +
      nur bei Änderung der Stations-Menge neu. — *Shader-Änderung, im Spiel prüfen.*

Sprachnachricht 4 (Bau-/Öl-/Zoll-Feedback) — erledigt:

- [x] **Ölpumpe skaliert mit Reichsgröße** (weniger am Anfang, mehr beim Wachsen):
      `oilProductionPerPump = 80 + tiles/130` statt fix 250.
- [x] **Wand-Umkreis sichtbar** beim Platzieren (Auto-Connect-Radius als Kreis).
- [x] **Baumenü zweite Reihe**: Verteidigungsposten/Zollstation/Wand/Ölpumpe immer
      in Reihe 2 (Wand nicht mehr oben).
- [x] **Zollstation ausgegraut ohne Hafen** (`waterTollStationSpawn` verlangt Port).
- [x] **Zollstation: Baubalken + viel längere Bauzeit** (5s→30s): Schiff hält an
      der Meerenge, Struktur „under construction" mit Balken, Versenken bricht ab.
- [x] **Anzahl ändern: Shift → Tab** (+ Mausrad, wenn Bau-Ghost aktiv). Shift bleibt
      wie es war; Tab verwirft den Ghost nicht.
- [x] **Zollstation-Platzierung** unterstützt bereits Ketten: 2 verschiedene Anker
      (Land+Station, Station+Station, oder zwei Landmassen), nur eine Seite muss
      Land sein — `tollStationConnections`. (Sichtbar wird's erst mit dem Render
      oben.)
- [x] **Kein Emoji-/Radialmenü beim Bauen**: bei aktivem Bau-Ghost platziert der
      Klick immer (kein Kontext-/Emoji-Menü über dem eigenen Namen).
- [x] **Schwarze Outline an Mauern** nur an den Kanten ohne Nachbarwand (außen +
      innen): pro Wand eine 4-Bit-Nachbarmaske, Fragment-Shader zeichnet dort Schwarz.

Erledigt in dieser Runde:

- [x] **Übersetzungs-Audit DE + EN vollständig**: 700 nur in en.json vorhandene
      Keys ins Deutsche übersetzt (fielen vorher auf Englisch zurück) — jetzt
      **volle DE/EN-Parität** (alle ICU-Platzhalter/Plurale validiert). Zusätzlich
      fehlenden `multi_tab.*`-Block (Multi-Tab-Warnung) in beide Dateien ergänzt
      (war im Code referenziert, fehlte in beiden → Roh-Keys für alle).
- [x] **Lobby-Rename**: gleichen Namen verbieten — `lobby-name-editor` lehnt
      Kollisionen (case-insensitiv) ab.
- [x] **KI baut Zollstationen** an Meerengen (Chokepoint = canBuild-Zwei-Landmassen-
      Regel; nahe eigener Küste auf gemeinsamem Wasser; per-Difficulty selten,
      Cap + Cooldown; `SeaBuildExecution` vom Hafen). — *Logik fertig, live prüfen.*
- [x] **Verteidigungsposten** nimmt kein neutrales Land ein — war bereits umgesetzt
      (`DefensePostExecution`: Einnahme nur bei `Relation.Hostile`).
- [x] **Sea-Build-Optik** — war bereits erfüllt: Bau-Schiff startet vom **Hafen**
      (`SeaBuildExecution.spawnTile`), ist ein `TransportShip` und bekommt darum
      denselben Trail wie das Expansions-Boot (`TRAIL_TYPES`).

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
- [x] **Eigene Clans erstellen/beitreten** (localapi Stage 3): `clans.ts`
      (ClansStore) + volle Endpunkte; Client `createClan` + „Clan erstellen"-Form
      im ClanModal. localapi jetzt in `npm run dev` (Proxy + `LOCALAPI_ISSUER`
      auf :9000 → kein Auto-Logout). Live verifiziert.
- [x] **Eigene Skins + Effekte mit Freischalt-Aufgaben** (statt Store): Katalog
      `resources/cosmetics/cosmetics.json` (8 Muster + Effekte), von der localapi
      unter `/cosmetics.json` ausgeliefert. Kostenlos = für alle; task-gesperrt =
      erst wenn Spielstats die Aufgabe erfüllen (Flares aus `computeFlares`).
      Gesperrte Items erscheinen ausgegraut mit Schloss + lokalisierter Aufgabe
      + Live-Fortschritt beim Hover („Gewinne 5 Partien (0/5)"). `unlock`-Feld im
      Cosmetic-Schema; `userMe` liefert `flares` + `stats`. Live verifiziert.

### 0.9 Sprachnachricht 3 (Leaderboard/Lobby/Avatar/Spawn/Stats) — erledigt

- [x] **Leaderboard funktioniert** — end-to-end verifiziert (Endpunkt +
      Client-Modal rendern Ränge, Siege/Niederlagen, ELO).
- [x] **Stats-Tracking für Accounts funktioniert** — verifiziert: `archive()`
      (Multiplayer + Singleplayer-Route) postet fertige Spiele an die localapi,
      `GamesStore.ingest` ordnet per `persistentID` (= Account-UUID) zu; speist
      `userMe.stats`, Leaderboard, Profil UND Cosmetic-Freischaltung.
      `GamesStore.statsFor` ergänzt.
- [x] **Lobby-Namensfeld beim Host zeigte Roh-Strings** (`lobby.your_name` …):
      statischer Host-Modal rendert beim Boot vor dem Laden der Übersetzungen,
      und der `lobby-name-editor` (kein reaktives Prop vom Eltern-Modal) wurde nie
      neu gerendert. Fix: `host-lobby-modal` + `lobby-name-editor` zur Re-Render-
      Liste im `LangSelector` ergänzt. Verifiziert („Dein Name / Speichern").
- [x] **Random-Spawn**: wer in einer (Nicht-Singleplayer-)Lobby keinen Startpunkt
      setzt, bekommt am Spawn-Phasen-Ende einen **zufälligen** Spawn statt „draußen"
      zu stehen. `SpawnTimerExecution` platziert unspawnte Menschen via tile-loser
      `SpawnExecution` (`Executor.spawnPlayerExecution`). Typecheck ok — Multiplayer
      noch live gegenzuprüfen (im Preview nicht voll durchspielbar).
- [x] **Profilbild-Upload** auf der Konto-Seite (hochladen/entfernen). Client
      verkleinert auf 128×128 (Canvas). localapi: **eine Datei pro Account**
      (`avatars/<publicId>.<ext>`, im `/data`-Volume → übersteht Redeploys),
      `GET /users/:publicId/avatar`, `userMe.avatarUrl`.
      **Sicherheit:** Bild-Validierung per **Magic Bytes** (PNG/JPEG/WebP, nicht
      der behauptete MIME), Cap **64 KB** dekodiert (413), Body-Limit **256 KB**,
      E-Mail-Länge **254** bei Register/Login. Live verifiziert (Upload/Entfernen +
      alle Ablehnungen: Nicht-Bild/zu groß/unauth/lange E-Mail).

### 0.8 Feedback-Backlog (Sprachnachricht 2) — NEU, offen

**Menü / Seite:**

- [x] **Logo klickbar → Startseite**: Logo ist jetzt `nav-menu-item` mit
      `data-page="page-play"` (Desktop + Mobile) → Klick führt ins Hauptmenü.
      Live verifiziert.
- [x] **Versions-Anzeige entfernt** (`#game-version`-Div + Import raus). Verifiziert.
- [x] **Lobby: Namensänderung** in der Lobby (Desktop **und** Handy) — ERLEDIGT.
      Neue Komponente `<lobby-name-editor>` in Host- + Join-Modal („Dein Name" +
      Speichern). Klick löst ein `lobby-rename`-DOM-Event aus; Main persistiert den
      Namen und ruft `lobbyHandle.updateIdentity`, was per **Reconnect** einen
      frischen Join sendet → Server nimmt den Reconnect-Pfad (Zensur +
      Identity-Update vor Spielstart) und broadcastet die Lobby neu. Live
      verifiziert (Name ändert sich in der Spielerliste). DE+EN-Strings ergänzt.
- [x] **Clans**: Eigene Clans erstellen + beitreten funktioniert. Backend
      `localapi/clans.ts` (ClansStore) + volle Clan-Endpunkte in LocalApi.ts;
      Client `createClan()` + „Clan erstellen"-Formular im ClanModal (My-Clans-Tab).
      Deutscher `clan_modal`-Block ergänzt (war nur EN). **Dazu localapi in `npm run
      dev` verdrahtet** (vite-Proxy `/localapi`→:8090, `LOCALAPI_ISSUER` auf
      :9000 gepinnt — sonst loggt der Client wegen iss-Mismatch aus). Live
      verifiziert: registrieren → [FLW] erstellen → Detailansicht → zweiter Account
      tritt bei. (Clan-Leaderboard/Spielverlauf bleiben leere Stubs.)

**Übersetzungen (Priorität: Deutsch + Englisch VOLLSTÄNDIG; andere Sprachen später):**

- [x] **Regel geklärt:** DE + EN werden im Repo manuell gepflegt (de.json + en.json
      synchron), Crowdin nur für andere Sprachen — CLAUDE.md entsprechend angepasst.
- [x] Alle sichtbaren Texte über `translateText` + `en.json`/`de.json`; **DE + EN
      komplett** — Audit erledigt: 700 fehlende DE-Keys übersetzt (volle Parität),
      ICU/Plurale validiert, fehlenden `multi_tab.*`-Block ergänzt. (Rest-Deko:
      116 veraltete Keys nur in de.json — harmlos, ungenutzt.)
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

- [x] Umkreis-/Granaten-Einnahme nimmt **kein neutrales** Gegner-Land ein,
      solange man **nicht im Krieg** mit dem Besitzer ist (nur Wildnis + echte
      Kriegsgegner). Umgesetzt in `DefensePostExecution.fireBarrage` (Einnahme
      nur bei `Relation.Hostile` in einer der beiden Richtungen).

**KI (alle Schwierigkeiten, angemessen skaliert):**

- [x] KI baut/nutzt **Ölpumpen** — `NationStructureBehavior.tryBuildOilPump`
      (auf eigenem Öl-Vorkommen, außerhalb der Nuke-Sparphase, ~1 Pumpe/20k
      Kacheln, erst nach der wirtschaftlichen Basis). Live verifiziert: Nation baut
      eine Pumpe, sobald sie die 200k-Gold-Schwelle erreicht.
- [x] KI baut **Wände** defensiv an der Angriffsfront (`tryBuildWall`, Medium+,
      Anzahl je Schwierigkeit) — nutzt dieselbe Front-Logik wie Verteidigungsposten.
- [x] **Verteidigungsposten**: baut die KI bereits (bestehend); Refactor auf
      generischen `countUnitsNearFront` (auch für Wände).
- [x] **Zollstationen**: KI baut sie jetzt — `tryBuildTollStation`. Meerengen-
      Erkennung über `canBuild(WaterTollStation)` (zwei Landmassen-Anker in Radius
      14); Kandidaten sind Wassertiles nahe der eigenen Küste auf **gemeinsamem
      Wasser** (wo fremde Boote fahren). Bau via `SeaBuildExecution` vom Hafen.
      Selten + per Difficulty gedeckelt (Easy 1/sehr rar … Impossible 3), mit
      Cooldown; teurer Scan nur wenn die seltene Chance trifft. **Live prüfen.**
- [~] KI versteht **Krieg**/Relationen bereits (AI-Attack/Warship nutzen
      `Relation.Hostile`); Kaperung feindlicher Strukturen passiert automatisch,
      wenn KI-Kampfschiffe nahe genug sind (`WarshipCaptureTracker`). Gezieltes
      „Struktur kapern"-Verhalten der KI wäre noch ein Zusatz.

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
