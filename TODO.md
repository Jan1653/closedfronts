# ClosedFronts – TODO / Roadmap

Detaillierte Feature-Liste. Querschnittsregel für ALLES: **muss auch auf der
Handy-/Mobile-UI funktionieren.**

---

## 🆕 Sprachnachricht 6 (neuestes Feedback) — großes Paket

Reihenfolge laut Nutzer: **erst die einfachen/kritischen Sachen.** Alles gesammelt.

### KRITISCHE BUGS

- [x] **Handy: nichts baubar** (Commit `44f7dbf`) — `MobileBuildBar` prüfte den
      tile-abhängigen `bu.canBuild` (ohne Tile immer `false` → alles grau). Jetzt
      nach Leistbarkeit + Voraussetzungen (wie Desktop). Live verifiziert: 10/15
      baubar bei 1,7K Gold.

### Bau-Icons / Texturen / Hotkeys

- [x] **Öllager-Hotkey** (Commit `3d624f1`): Alt+4 gebunden + Label „Alt 4".
- [x] **Multi-Bau-Zahl** (Commit `0a40349`): Ghost-Kosten-Label zeigt jetzt
      „<Kosten> xN" beim Tab+Scroll-Mehrfachbau. Live verifiziert.
- [ ] **Karten-Texturen (WebGL-Atlas) — braucht Sprite-Art:** Ölpumpen-Karten-
      Sprite ist „Kreis+Dreieck" (das Bau-/Bar-SVG ist bereits ein Öltropfen);
      Öllager nutzt mangels eigenem Sprite die Pumpen-Textur (`StructurePass:166`).
      Beide brauchen eigene Atlas-Sprites (Grafikarbeit, kein Code-Fix).

### Zollstation

- [x] **Ausgegraut ohne Hafen** — Zollstation braucht (wie das Kriegsschiff)
      einen **fertigen** Hafen, der sie per Boot erreicht; Bau-Balken (Desktop +
      Mobile) graut sie sonst aus. Die per-Kachel-Vorschau (grün/rot) greift eh
      schon über `canBuild`. (`UnitDisplay`/`MobileBuildBar`.)
- [x] **Zwei Landmassen verbinden**: `tollStationConnections` verbindet jetzt
      **zwei verschiedene, im Umkreis nicht (über Land) verbundene** Landmassen,
      wenn beide in Reichweite sind (Land-BFS begrenzt auf den Radius). Fallback:
      eine Landmasse + Ketten-Station. Rendering zieht automatisch beide Linien.
- [x] **~100.000 pro durchfahrendem Schiff** (`TOLL_GOLD` 10k → 100k).

### Wasser-Strukturen erobern (Kriegsschiff)

- [x] Kriegsschiff **steuert erobernbare Wasser-Strukturen aktiv an** (See-Ölpumpe
      + Zollstation): neue Priorität in `WarshipExecution` fährt hin und **hält**
      in Capture-Reichweite, bis der 60-Tick-Timer (`WarshipCaptureTracker`)
      füllt. Damit greift sowohl **manuelles Anvisieren** (Schiff hinschicken) als
      auch **Auto-Übernahme im Krieg** (`canAttackPlayer`-Filter). Nur Strukturen
      auf offenem Wasser + gleicher Wasser-Komponente werden angesteuert.

### Bomben / Raketensilo / Kriegsschiff-Gating

- [x] Bomben/Kriegsschiff erst **entgraut, wenn Silo/Hafen FERTIG** (Commit
      `9d10301`): `!isUnderConstruction`-Filter in Desktop- + Mobile-Bar.
- [x] **Elektrobomben-Radius** (Commit `eee3d4f`): + Flugbahn/Allianz-Warnung/
      Ghost-bleibt, wie Atom/Wasserstoff.
- [x] **„Bomben"-Button** ersetzt die Einzel-Bomben (Commit `2e81ac6`): PC-Fly-out
      mit 4 Buttons (Elektro/Atom/Wasserstoff/MIRV), **gemerkte Auswahl**
      (localStorage); Handy nur der „Bomben"-Button + Fly-out. Live bestätigt.
- [x] **PC-Bar breiter** (500→620px): 12 Items jetzt in **einer Reihe**. Live bestätigt.

### Handy-UX

- [x] **Preise auf dem Handy** (Commit `c56109e`): Goldkosten unter jedem
      Bau-Button. Live verifiziert (750K, 25M, 200K …).
- [x] **Multi-Bau-Auswahl auf dem Handy** — war bereits in `MobileBuildControls`
      (×N mit −/+, Bauen/Abbrechen), nur durch den Grau-Bug blockiert. Live
      bestätigt: „− ×3 + Abbrechen Bauen" erscheint beim Armieren.

### Mauern (Walls) — Bausystem-Umbau

- [ ] **Neues Ziehen-Bausystem**: Mauer wählen → 1 Pixel am Cursor, 1. Klick
      setzt Start, dann zieht die Mauer mit dem Cursor mit, 2. Klick baut die
      Linie. **Handy:** Start antippen, Ziel antippen, **kein** Auto-Bau — extra
      **Bauen**-Button + **Abbrechen**-Button.
- [x] **Outline-Fix**: die 4-Bit-Nachbarmaske kannte nur orthogonale Nachbarn,
      also zeigten **diagonal** verbundene Mauern (die Auto-Connect-Bresenham-
      Linie schrittet diagonal) eine schwarze Naht an der Ecke. Maske um 4
      Diagonal-Bits erweitert; der Fragment-Shader unterdrückt die Outline im
      Eckquadrat, wo eine Diagonal-Mauer anschließt. Außenkanten behalten die
      Outline. (`WallPass` + `wall.frag.glsl`; strikt additiv, gerade Mauern
      unverändert.)
- [ ] **Angriffs-Bar an der Mauer**: beim Angriff eine Bar, wie weit bis zur
      Zerstörung an der Stelle (die dem Angreifer am nächsten liegt). Bar wird
      langsamer bei weniger Truppen und **revertet** bei Gegenangriff/Rückeroberung.
- [ ] **Mauerfall = nur 3 Pixel** hinter der Mauer an den Gegner geben (aktuell
      wird alles hinter der Mauer sofort rübergeschoben) — diese 3 Pixel sind
      dann normal angreifbar.
      **Regel (entschieden):** 3-Kachel-**Brückenkopf** — der Angreifer bekommt
      beim Durchbruch genau ~3 Kacheln direkt hinter der Bruchstelle; alles tiefer
      dahinter bleibt weiter von der (übrigen) Mauer geschützt/deferiert.

### Lobby-Defaults

- [x] **Öl spenden** in privaten Lobbys **standardmäßig AUS** (Commit `8eeeac2`).

### Bot-KI (Öl)

- [x] **Öl als Ziel Nr. 1 bei Mangel** (Commit `5702e34`): sinkt das Öl unter
      eine schwierigkeitsabhängige Schwelle (Easy 10% … Impossible 35% der
      Kapazität), baut der Bot prioritär eine Pumpe auf ein eigenes Vorkommen
      (oder stapelt eine) — vor dem größenbasierten Ziel. Schwer+ reagiert früher.
- [ ] Bots ab **schwer**: Spawnpunkt etwas näher an Öl-Vorkommen. (Verschoben —
      Bot-Spawn läuft über den geteilten `SpawnExecution`-Pfad; Öl-Bias dort ist
      riskanter für marginalen Nutzen.)

---

## 🆕 Sprachnachricht 5 (aktuellstes Feedback) — großes Paket

Reihenfolge laut Nutzer: **erst die einfachen Sachen.** Alles hier gesammelt.

### A. Öl-Ökonomie / Ölpumpen

- [x] **Ölpumpen geben noch weniger & langsamer Öl** — `oilProductionPerPump`
      auf `10 + tiles/600` gesenkt (war `25 + tiles/300`).
- [x] **Öl wird mehr gebraucht** — Verbrauch hoch (`tiles/100` statt `/120`,
      `cityOilConsumption` 2→3).
- [x] **Ohne Öl wirklich sehr langsam** — `oilShortageSpeedFactor` 0.3 → 0.12.
- [x] **Ölpumpen stapeln → Level (2, 3, …)**: Ölpumpe ist jetzt aufrüstbar
      (`upgradable`), draufbauen erhöht das Level. Produktion skaliert mit Level
      (Σ Level × Basis in `updateOil`), **Explosionsradius wächst mit Level**
      (`oilPumpRadius(level)` = 15 + 5·Level). Im Sim verifiziert.
- [~] **Ölpumpe weggebombt → Atomexplosion**: die Öl-Sekundärexplosion ist jetzt
      **level-skaliert** (bis Atombomben-Radius) und kratert Land/zerstört Einheiten
      (`OilExplosionExecution(tile, level)`). *Echte Atom-Mushroom-VISUAL-FX noch
      offen (FX-Pass-Plumbing) — Politur.*
- [x] **Öllager-Gebäude** (neuer Bau `UnitType.OilStorage`): vergrößert die
      **Öl-Kapazität** — `maxOil(player)` = Basis 5000 + Σ (Öllager-Level × 8000).
      Aufrüstbar. Im Baumenü + eigenes Icon + DE/EN. Karten-Icon vorerst = Ölpumpe
      (eigene Atlas-Spalte = Politur). Im Sim verifiziert.
- [x] **Öl-Überschuss automatisch verkaufen**: Tank voll + Pumpe pumpt weiter →
      Überschuss → Gold (`floor(excess / oilSellDivisor=12)`, also sehr wenig).
      Im Sim verifiziert (Öl bleibt am Cap, Gold steigt).
- [x] **Öl verschenken (Alliierte)**: „Öl senden"-Button im Spieler-Panel (nur
      bei Alliierten sichtbar via `canDonateOil`), öffnet die `SendResourceModal`
      im neuen **oil-Modus** (blau, Menge bis zum Empfänger-Öl-Cap). Voller
      Intent/Execution-Pfad (`donate_oil` → `DonateOilExecution`), Empfänger nimmt
      nur, was unter seinen Cap passt. **Game-Einstellung** „Öl spenden" im
      HostLobbyModal (Default an). DE/EN-Keys. Im Sim verifiziert (Transfer, Cap,
      Setting-aus blockt Menschen, Allianz nötig) + Modal-Render geprüft.
- [x] **KI lernt das Öl-System**: `NationStructureBehavior` baut jetzt **Öllager**
      (`tryBuildOilStorage`, ~1 pro 2 Pumpen, gedeckelt) und **stapelt Ölpumpen**
      (in `tryBuildOilPump`: bei leerem Tank wird die niedrigste Pumpe gelevelt
      statt ein rares neues Vorkommen zu suchen). Im Sim verifiziert (öl-knappe
      Nation stapelt, 2-Pumpen-Nation baut Lager). Keine Regression (die 11 roten
      NationStructureBehavior-Tests sind **vorbestehend** — veraltete
      Verteidigungsposten-API, unabhängig).
  - [ ] **KI Öl an Alliierte schenken** — bewusst ausgelassen: Nationen schenken
        aktuell **gar nichts** (kein Gold/Truppen); wäre inkonsistenter Neubau.
        Optionaler Folge-Punkt.
- [x] **Öl-Bar wie Truppen-Bar** (PC **und** Handy): neue `renderDesktopOilBar`/
      `renderMobileOilBar` (blaue Füllung = Öl/maxOil, Öl/Max + Icon, „+N/s"-Chip),
      klickbar = Öl-Karten-Toggle. Desktop: Öl-Bar neben der Truppen-Bar (beide
      flex-1 → Truppen-Bar etwas kleiner). Mobile: Öl-Box durch kompakte Öl-Bar
      ersetzt. Füllstand + „/s" im Browser verifiziert. *(Mobile-Feinlayout kommt
      im großen Mobile-Paket C.)*
- [x] **Öl pro Sekunde anzeigen** — das schwebende „+N" über jeder Ölpumpe ist
      jetzt **level-aware** (× Pumpen-Level) und überspringt deaktivierte Pumpen;
      war bereits pro Sekunde (×10). Öl-Bar zeigt „+N/s".
- [x] **Öl-Flecken: weniger & größer, nussigere Formen** — `OilDeposits.ts`
      neu: CELL 64, ~1/4 Anker, Basisradius 8–17, zweite versetzte Lobe →
      Erdnuss-/Nuss-Silhouette statt Kreis (integer-only, deterministisch).

### B. Bomben

- [x] **Nur EIN Bomben-Button** in der Bau-Leiste. Darüber öffnet sich ein
      kleines **Auswahl-Menü** (mittig, über allem, `bomb-picker-overlay`) mit
      den Bomben. PC + Handy (`BuildMenu.ts`). Neue Bombe = 1 Zeile in
      `BOMB_UNIT_TYPES` + Build-Table-Eintrag. DE/EN-Keys ergänzt (`unit_type.bomb`,
      `build_menu.desc.bombs`, `build_menu.select_bomb`).
- [x] **Elektrobombe (neu)**: neuer Nuke-Typ `UnitType.ElectricBomb`, fliegt/
      startet wie eine Atombombe (nutzt `NukeExecution`, Atombomben-Grafik per
      Alias), **detoniert → deaktiviert alle Strukturen im Radius** statt zu
      zerstören. Deaktiviert = Einheit `isDisabled()` (zeitbasiert, `disableUntil`
      + `ElectricDisableExecution` re-synct Client bei Ablauf, 30 s). Gates:
      Verteidigungsposten feuert nicht, Ölpumpe produziert nicht, Hafen keine
      Handelsschiffe, SAM fängt nicht ab, Stadt zählt nicht (Öl/Truppen); Struktur
      rendert gedimmt/inaktiv. Kosten **leicht > Atombombe** (900k vs 750k). Im
      Sim verifiziert (Wegwerf-Test: deaktiviert Stadt/Posten/SAM ohne Zerstörung,
      reaktiviert nach 300 Ticks). DE/EN-Keys + Icon ergänzt.
  - [ ] **Politur**: echtes **Grau** (Desaturierung) statt nur Dimmen — braucht
        eine Shader-Änderung im StructurePass (eigener „disabled"-Kanal).
  - [ ] **KI** soll die Elektrobombe nutzen (Struktur-Cluster deaktivieren vor
        Einnahme).
  - [ ] Auch **mobile Einheiten** (Kriegsschiffe) optional deaktivieren (v1: nur
        Strukturen).

### B2. SAM-Rücksender (Abwehr fängt Bomben)

- [x] **Früher & für mehr Bomben**: Der SAM-Rücksender fängt/kapert jetzt schon
      **ab Level 2** (25 %) und ist **bei Level 5 garantiert** (100 %, +25 %/Level)
      — vorher Atom erst ab L5, Wasserstoff ab L10, 100 % erst bei L15. Gilt für
      **Atom-, Wasserstoff- UND Elektrobomben**; gekaperte Bombe landet kostenlos
      im Stockpile (Neustart gratis). SAM fängt Elektrobomben jetzt auch ab
      (beide Whitelists). Im Sim verifiziert (L5 kapert Elektrobombe, gratis
      Neustart) + Config-Tabelle getestet. DE/EN-Key `electric_bomb_captured`.

### C. Handy-Layout / Mobile-UX (großer Umbau)

- [ ] **Landscape am Handy → mehr PC-Optik**: kippt man das Handy quer, soll die
      GUI eher wie am PC aussehen (Desktop-Layout der Bars/Panels), die
      **Steuerung** bleibt aber fürs Handy angepasst (Touch, große Ziele).
- [~] **Vollbild-Button** in der oberen Button-Leiste — **existiert bereits**
      (`GameRightSidebar`, neben Ölkarte/Einstellungen), aber nur wenn
      `document.fullscreenEnabled`. Auf **iOS/iPhone ist die Fullscreen-API nicht
      verfügbar** → Button fehlt dort; echte „Vollbild"-Lösung auf iOS ist die
      **PWA/Zum-Home-Bildschirm**. Offen: Button auch am Handy sichtbar/erreichbar
      machen (Android) + iOS-Fallback (PWA-Hinweis).
- [x] **PWA-Installation** sauber: Apple-Meta-Tags ergänzt
      (`apple-mobile-web-app-capable=yes` → iOS-Standalone/Vollbild,
      `status-bar-style=black-translucent`, `apple-mobile-web-app-title`,
      **apple-touch-icon** = icon512_rounded.png), `theme-color` +
      `mobile-web-app-capable`; Manifest um `theme_color`/`background_color`
      ergänzt und **`orientation: "portrait" → "any"`** (Landscape war vorher
      gesperrt!). Apple-Touch-Icon CDN-aware in **beiden** HTML-Renderern
      (`RenderHtml.ts` **und** `vite.config.ts`/vite-plugin-html — Letzteres fehlte,
      hätte den Dev-Server gebrochen). Safe-Areas waren schon da. Im Browser
      verifiziert (Head-Tags, Icon 200/PNG, Manifest orientation=any).
- [x] **iOS-Banner zeigt Roh-Keys** (`ios_banner.text/how/later/never`): rendert
      am Boot vor dem Laden der Übersetzungen → `ios-add-to-home-screen-banner`
      in die `LangSelector.applyTranslation`-Re-Render-Liste aufgenommen (gleicher
      Fix wie beim Lobby-Namen). Verifiziert: `applyTranslation` ruft jetzt
      `requestUpdate()` auf dem Banner, Keys lösen sich auf.
- [x] **Truppen-Angriffs-Bar nach links**: neue `mobile-attack-bar` (linker Rand,
      links-mittig, gespiegelt zur Bau-Bar rechts) — großer **vertikaler Slider**
      (viel besser bedienbar als der winzige Slider in der unteren Leiste) mit
      %-Anzeige + Truppenzahl. Schreibt/liest `uiState.attackRatio` (die geteilte
      Wahrheit); der ControlPanel synct sich jeden Tick. Angriffs-Slider aus der
      mobilen unteren Leiste entfernt (Öl-/Truppen-Bar dadurch breiter). Logik im
      Browser verifiziert (Slider ändert Ratio). **Touch/Position am Gerät prüfen.**
- [ ] **Öl-Bar** ans Truppen-Bar-Design angleichen (siehe A).
- [x] **Bau-Bar rechts** (Handy) + zweistufiges Tap-Placement: neue Komponenten
      `mobile-build-bar` (rechte vertikale Leiste, alle baubaren Sachen inkl.
      Bomben) + `mobile-build-controls` (unten Mitte: Bauen/Abbrechen + Mengen-
      Stepper). Item antippen → `ghostStructure` gesetzt; auf Kachel tippen setzt
      die Ghost-Position (neues `MobilePlacementTapEvent` statt `TouchEvent`, Karte
      bleibt verschiebbar), „Bauen" bestätigt über das bestehende
      `ConfirmGhostStructureEvent`. Nutzt die vorhandene Ghost-Vorschau-Infra
      (funktioniert auch für Bomben). Logik im Browser verifiziert (Bar rendert/
      armt, Controls Bauen/Abbrechen/Menge). **Touch-Flow noch auf dem Gerät
      gegenzuprüfen.** *(Der Mengen-Stepper deckt „mehrere bauen" ab.)*
- [x] **„Catching Up" kommt zu oft** — Ursache: `GameView.isCatchingUp()` gab
      schon bei `pendingTurns > 1` true (2 gepufferte Turns = normales Jitter,
      v. a. am Handy). Schwelle auf `> 5` angehoben (~0,6 s echter Rückstand),
      zusammen mit der bestehenden 10-Tick-Sustain-Bedingung im `HeadsUpMessage`.
      Rein kosmetisch (Client holt so oder so auf), treibt nur den Banner.

### D. Zollstation (Feinschliff)

- [x] **Bauen-Button beim Wasser-Klick** (Handy **und** PC): das Radialmenü zeigte
      den Bauen-Button nur bei **eigenem Territorium** (`isOwnTerritory`) — Wasser
      gehört nie jemandem, also fehlte er. Neuer expliziter **Wasser-Zweig**
      (Info + **Bauen** + Boot) in `rootMenuElement.subMenu`, sodass man Zollstation
      / See-Ölpumpe direkt bauen kann. Verifiziert (Radialmenü-Test + Wasser-Fall).
- [x] **Schiff fährt durch → Geld-Popup** wie bei Häfen: die Maut wird jetzt
      **direkt dem Stations-Besitzer** gutgeschrieben (`owner.addGold(paid, tile)`
      → schwebendes „+N"-BonusEvent am Stations-Tile). Das **gesamte
      Einsammel-Schiff-Design entfernt** (pendingGold/collector/Hafen-Abholung
      raus) — `WaterTollStationExecution` deutlich schlanker. Im Sim verifiziert
      (Gegner-Boot zahlt, Besitzer direkt gutgeschrieben, kein Einsammel-Schiff).
- [x] **`WaterTollStation.test.ts` repariert** (war vorbestehend kaputt): Helper
      auf die neue Verbindungsregel umgestellt (`>= 1` statt `=== 2`),
      Platzierungs-Tests bauen den erforderlichen Hafen, Map von der sehr langsamen
      „world" auf `ocean_and_land`. **10/10 grün in 5,5 s** (vorher 240 s / 9 rot).
- [ ] **Verbindungsregel**: Station kann mit **2 verschiedenen Landmassen** ODER
      **1 Landmasse** verbunden sein — aber **nicht 2×** mit **derselben**
      Landmasse (außer die Verbindung ist sehr weit weg).
- [ ] **Bug: rotes Fadenkreuz bleibt** auf einer Zollstation hängen, wenn man ein
      Kriegsschiff auswählt und ein Ziel anklickt (CrosshairPass säubern).
- [x] **Radius etwas höher** — `WATER_TOLL_STATION_RADIUS` 14 → 18.

### E. Handy: „Auswählen"-Button (Mehrfachauswahl)

- [x] **ERLEDIGT** (Details unten): `mobile-select-button` togglet
      `uiState.mobileSelectMode`; InputHandler zieht dann bei Ein-Finger-Drag eine
      Auswahlbox statt zu pannen und deaktiviert Pinch-Zoom → Kamera gesperrt.
      Logik im Browser verifiziert (Toggle + Highlight). Touch am Gerät prüfen.
- [ ] Oben rechts am Handy neuer Button **„Auswählen"** = wie **Shift** am PC:
      damit mehrere Boote/Einheiten markierbar. Solange aktiv: **Kamera nicht
      bewegen/zoomen** (Karte gesperrt, nur Auswahl).

---

## ⭐ Offene Punkte (Kurzübersicht)

Was noch aussteht (Details in den jeweiligen Abschnitten unten):

Nur noch live gegenzuprüfen (Logik steht, du testest im Spiel):

- [ ] **Random-Spawn** in echter Multiplayer-Lobby (fehlender Startpunkt → zufällig).
- [ ] **Zollstation-Rundtrip** (Einsammeln + Abfangen + Verlust).
- [ ] **KI-Zollstationen** an Meerengen (selten, esp. Easy) — im Spiel beobachten.

Noch offen (echte Arbeit):

- [ ] **Map-Editor** (ganz unten) + **Reale-Karten-Import** aus Geodaten.
      (Einziger verbliebener großer Punkt — von dir ausgeklammert.)

- [x] **Schiffe umgehen Zollstationen**: Transport-Schiffe (Expansions-/Angriffs-/
      Sammel-/Bau-Boote) weichen dem Gate einer feindlichen Zollstation aus
      (`TollAvoidance` — Sidestep zum gate-freien Nachbarn nächst zum Ziel), mit
      Schritt-Budget. Klappt der Umweg nicht in der Budget-Grenze bzw. ist die
      Meerenge der einzige Weg → durchfahren + zahlen. Sicher (No-op ohne
      Zollstationen, terminiert immer, deterministisch), Render folgt der Route.
      Trade-Ships vorerst ausgenommen (Motion-Plan-Interpolation). — *im Spiel prüfen.*

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
- [x] **Zollstation-Platzierung (neue Regel)**: braucht nur **eine** Verbindung —
      zu Land **oder** zu einer anderen Station. Höchstens 1× Land + 1× Station
      (also 1 Land, 1 Station oder beides), aber **nie zwei Land-Verbindungen**.
      Behebt: neben einer einzelnen Station (offenes Wasser) war fälschlich nicht
      platzierbar. Weite Meerengen überspannt man per Stations-Kette.
      (`tollStationConnections`.)
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

**Turn 1 (ERLEDIGT — Commit `c5aad34`):** Editor-Grundgerüst + lokales Speichern.

- [x] Neuer Button **„Karte erstellen"** im Hauptmenü (`GameModeSelector`) öffnet
      `<map-editor-modal>` (`components/map/MapEditorModal.ts`).
- [x] **Kern-Konvertierung** `CustomMapBuilder.buildCustomTerrain` (gemalte Kacheln
      → Spiel-Byte-Format: Ozean-Flood-Fill, Küsten-Erkennung, `numLandTiles`).
- [x] **Terrain-Tools** Land / Wasser / Gebirge, Pinsel + Größe, **Füllen** (Eimer),
      **Löschen**, Größe einstellbar mit Min/Max (40–240), **benennen**.
- [x] **Speichern lokal** (`CustomMapStore`, localStorage) + Liste mit Laden/Löschen.

**Turn 2 (ERLEDIGT — Commit `e72f4e0`):** Custom-Map im Singleplayer spielbar.

- [x] „Spielen"-Buttons im Editor (aktuelles Bild + pro gespeicherter Karte)
      starten ein Solo-Spiel; `join-lobby` mit `config.customMap`.
- [x] Payload reist serialisiert (base64) in `GameConfig.customMap` → erreicht
      Renderer **und** Sim-Worker; beide kompilieren dasselbe Terrain
      deterministisch (kein CDN-Fetch). `buildCustomTerrainMapData` (Voll- +
      Halb-Auflösungs-Mini-Map für Pathfinding). Bots skalieren mit Landfläche,
      keine Nationen. Verifiziert: echter Sim (40 Ticks + Land-Angriff) grün.
- [x] Custom-Maps im **Solo-Menü** wählbar (Commit `37a9197`): „Meine Karten"-
      Leiste über dem Map-Picker mit Canvas-Thumbnail (`<custom-map-thumb>`);
      Auswahl überschreibt die offizielle Karte, volle Solo-Optionen gelten.
- [ ] Custom-Maps auch im **Lobby**-Map-Picker (MP, erst mit Server-Verteilung).
- [ ] **Multiplayer**-Custom-Maps (Server muss Payload an alle Clients verteilen).

**Turn 4 (ERLEDIGT — Commit `0f8afa0`):** Karten teilen ohne Backend.

- [x] **Export/Import** als `.cfmap`-Datei (JSON) mit strikter Validierung
      (Dimensionen, Paint-Größe); Round-Trip + Fehlerfälle unit-getestet.
- [x] Editor-Liste zeigt **Canvas-Thumbnails** pro Karte.
      → Überbrückt das Teilen, bis der Community-Browser/das Backend steht.

**Turn 5 (ERLEDIGT — Commit `21677c0`):** Community-Backend (localapi).

- [x] `MapsStore` (datei-gestützt) + `/localapi/maps`-Endpunkte: browse
      (sort likes/new, Suche, betrachter-abhängiges `likedByMe`), publish
      (auth, Dimensions-/Paint-Validierung), detail mit paint, like/unlike,
      delete (nur Autor), `/maps/mine`. Client-API-Wrapper in `Api.ts`.
- [x] End-to-end per curl verifiziert (register→publish→like→detail→delete→404,
      401/400-Fehlerpfade). ⚠️ Dev-localapi (8090) muss neu gestartet werden,
      damit die Routen lokal greifen (kein Auto-Restart).

**Turn 6 (ERLEDIGT — Commit `d6e8fa6`):** Community-Frontend.

- [x] **„Community-Karten"**-Button im Hauptmenü öffnet `<community-maps-modal>`
      mit Filtern **Beliebteste/Neueste/Meine** (`browseCommunityMaps`/`getMyCommunityMaps`).
- [x] **Liken** (`likeCommunityMap`), **„Übernehmen"** → Community-Map in eigene
      Custom-Maps (localStorage), **„Spielen"** → direkt Solo (`playCustomMapSolo`).
- [x] Editor: **„Veröffentlichen"**-Button pro Karte (`publishCommunityMap`, auth-gated).
- [x] Play-Config in `playCustomMapSolo()` zentralisiert (Editor + Browser teilen sich eine Quelle).

**Turn 7 (ERLEDIGT — Commit `14cd68c`):** Painter mit mehr Terrain-Stufen.

- [x] Palette von 3 → **6 Stufen**: Wasser, Tiefwasser, Ebene, Hochland, Berg,
      Gipfel (Wand). Jede mappt auf die Höhen-Magnitude, die der Renderer als
      eigenes Farbband zeichnet (Ebene grün, Hochland braun, Berg grau, Gipfel
      Wand; Wasser dunkelt mit Tiefe). Farben zentral (`PAINT_TILE_RGB`),
      Mini-Map-Downscale behält höchste Landstufe. Alte Werte 0/1/2 kompatibel.
      Verifiziert im echten `GameMapImpl` (TerrainType/Magnitude je Stufe).

**Community-Frontend (Rest, offen):**

- [ ] Startseite zeigt die **meistgelikten** Community-Maps (bisher nur im Modal).
- [ ] Pixel-**Thumbnails** in der Community-Liste (Summary trägt kein Paint;
      bräuchte ein Thumb-Feld oder Lazy-Detail-Fetch).
- [ ] Community-Map im **Solo-Picker** direkt wählbar (aktuell: erst „Übernehmen").

**Reale Karten importieren (aus Geodaten eine Map generieren):**

Kern: `src/core/game/OsmRaster.ts` (pur/getestet) + `src/client/components/map/OsmSource.ts`
(Overpass/Nominatim) + OSM-Leiste in `MapEditorModal`. Phase A steht (Commits
`d8798dd`, `9ba1865`, `39b44b4`). Netzwerk-Calls **nicht** auf dem Dev-Host
verifizierbar → im Browser live testen.

- [x] Ort eingeben → **spielbare Map generiert** (`geocodePlace` Nominatim →
      Bbox → Grid → Overpass-Wasser → rastern → ins Editor-Grid). Slippy-Map
      zum Rechteck-Ziehen ist noch offen (Phase D).
- [x] Daten aus **offen lizenzierten** Quellen (OSM/ODbL, Attribution gezeigt).
- [x] **Flüsse durchgehend**: `waterway`-Linien als kontinuierliche Striche
      (`rasterizeLinesInto`, Sub-Zellen-Schritte, keine Lücken) — verifiziert.
- [x] **Bbox-Deckelung** (`clampBBox`): riesige Orte (Region/Land) → Stadt-Zentrum.
- [x] **Küstenlinien** (`natural=coastline`) → Meer (`applyCoastlineSea`,
      Commit `0fd5a0f`): Flood-Fill von der See-Seite (OSM Land-links-Regel) mit
      **Guard** — leckt der Fill auf die Landseite oder flutet >95%, wird er
      verworfen (Karte bleibt Land, keine Regression). Live-Test empfohlen.
- [ ] **Terrain-Typen** aus `landuse`/Höhe (DEM) — mappt nicht sauber aufs
      Höhen-Modell, braucht Konzept. Phase B/C.
- [ ] **Entrauschen** (Streu-Pixel), erst grobe Flächen, dann verfeinern.
- [x] Ergebnis ist eine normale Custom-Map (benennen, spielen, veröffentlichen).

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
