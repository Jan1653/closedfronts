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

### 0.2 „Explosion" der Zollstation beim Platzieren

- [x] Core-Test beweist: die Station bleibt in der Simulation **aktiv/lebendig**,
      sie explodiert dort NICHT → reines **Client-Rendering-Thema**.
- [ ] **Nach dem Icon-Fix erneut prüfen** (Ghost/Icon jetzt korrekt → sehr
      wahrscheinlich behoben). Falls es dann noch „explodiert": live diagnostizieren.

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
- [ ] Sea-Build im Meer (siehe unten)
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
