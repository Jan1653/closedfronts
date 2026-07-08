# ClosedFronts – TODO / Roadmap

Detaillierte Feature-Liste. Querschnittsregel für ALLES: **muss auch auf der
Handy-/Mobile-UI funktionieren.**

---

## 0. Aktuelles Feedback-Backlog (Stand: neustes Sprachfeedback)

Alles aus der letzten Sprachnachricht, damit nichts vergessen wird.

### 0.1 Eigene Karten-Icons (Ölpumpe / Wand / Zollstation)

- [ ] **Die schönen Bar-Icons (SVG) auch auf der Karte + beim Platzieren nutzen.**
      Nutzer mag die Hotbar-Icons (`OilPumpIconWhite.svg`, `WallIconWhite.svg`,
      `TollStationIconWhite.svg`) und will sie als Karten-Icon.
- [ ] **Umsetzung:** abhängigkeitsfreier PNG-Encoder (nur Node `zlib`), der die
      3 Icons in je eine neue 64px-Spalte des `resources/atlases/icon-atlas.png`
      backt (384×64 → 576×64, 6 → 9 Spalten). Nutzer hat den Encoder ausdrücklich
      freigegeben. `node-canvas` ist NICHT nutzbar (native Binary via
      `--ignore-scripts` nicht gebaut) → eigener Rasterizer:
  - Wand + Zollstation = reine Rechtecke (weiß = opak, `#0a1628`-Details = Loch).
  - Ölpumpe = Tropfen (Kreis r6.5 @ (12,14.5) ∪ Dreieck zur Spitze (12,2)).
- [ ] **StructurePass:** `STRUCTURE_ORDER` auf 9 erweitern (UT_OIL_PUMP, UT_WALL,
      UT_WATER_TOLL_STATION), die Platzhalter-Spalten-Zuweisungen entfernen.
- [ ] **render-settings.json:** `shapes`-Einträge für die 3 neuen Typen ergänzen
      (sonst falsche `uShapeScales`/`uIconFills`).
- [ ] **Behebt zugleich den Hover-Cross-Highlight** (Hover über „Fabrik" hebt
      aktuell auch die Ölpumpe hervor, weil beide dieselbe Atlas-Spalte teilen).

### 0.2 „Explosion" der Zollstation beim Platzieren

- [x] Core-Test beweist: die Station bleibt in der Simulation **aktiv/lebendig**,
      sie explodiert dort NICHT → reines **Client-Rendering-Thema**.
- [ ] **Nach dem Icon-Fix erneut prüfen.** Screenshot zeigt Port-Platzhalter +
      verstreute weiße Punkte an den Landmassen — vermutlich Platzhalter-Optik.
      Falls es dann noch „explodiert": live diagnostizieren.

### 0.3 Hotkey-Reihenfolge + Beschriftung

- [ ] **Bar-Reihenfolge neu ordnen:** die ersten 10 Bauten belegen **1,2,3,4,5,6,
      7,8,9,0** in Bar-Reihenfolge; die 3 Zusatzbauten (Wand/Ölpumpe/Zollstation)
      wandern **ans Ende** und bekommen **Alt+1 / Alt+2 / Alt+3**.
- [ ] **Hotkey-Hinweis auf JEDEM Button anzeigen** — auch „Alt 1", „Alt 2",
      „Alt 3", damit man sieht, wie man sie drückt (aktuell fehlt der Hinweis
      bei den Zusatzbauten komplett).
- [x] Alt statt Strg (Browser reserviert Strg+Zahl für Tab-Wechsel).

### 0.4 Öl-Verbrauch beim Vergrößern in die Wildnis

- [ ] „Es kostet kein Öl, wenn man sich in die Natur vergrößert." Prüfen —
      evtl. Nebeneffekt der Produktions-Erhöhung (Tank bleibt voll). Ggf.
      Expansion in Wildnis **explizit Öl kosten** lassen oder Verbrauch spürbarer
      an Wachstum koppeln. (Nutzer war unsicher, ob schon gefixt.)

### 0.5 Wände dürfen sich NICHT stapeln

- [ ] Wände sollen **Mindestabstand** wie andere Strukturen haben (aktuelles
      `wallSpawn` erlaubt Stapeln/Anreihen ohne Abstand → zurückbauen).
- [ ] Stattdessen **Umkreis**: liegt eine andere Wand im Umkreis, **verbinden**
      sich die zwei automatisch zu einer Wand-**Linie** dazwischen (gleiche Logik
      wie Straße Stadt↔Fabrik). Siehe 3.

### 0.6 Verteidigungsposten-Balancing

- [ ] **Halb so schnell angreifen** (Basis-Sperrfeuer-Rate halbieren).
- [ ] **Beim Stacken/Upgraden schneller** angreifen (Level → höhere Feuerrate,
      kompensiert die Halbierung).
- [x] Radius wächst beim Stacken (funktioniert schon, beibehalten).
- [ ] **Etwas teurer** machen.

---

## 1. Water Toll Station (Zollstation)

- [x] Core: Typ, Konfiguration, Platzierung auf Wasser zwischen zwei Landmassen
- [x] Kapern durch feindliches Kampfschiff (getestet)
- [x] Maut kassieren: Feinde & Neutrale zahlen, eigene/verbündete frei (getestet)
- [x] Build-Menü-Eintrag + Radius-Vorschau + auf Karte sichtbar (Platzhalter)
- [x] Überlebt den echten Baupfad in der Simulation (Regressionstest)
- [ ] **Eigenes Icon** statt Hafen-Platzhalter → siehe 0.1
- [ ] **Grüne Vorschau, wenn gültig:** Umkreis wird grün, sobald Landmasse(n) im
      Umkreis; bei **zwei** Landmassen die zwei nächsten verbinden. **Verketten:**
      Verbindung auch zu **einer Landmasse + einer anderen Zollstation** im
      Umkreis erlaubt (so über lange Strecken bauen).
- [ ] Die zwei „Straßen"-Verbindungslinien zeichnen (Client)
- [ ] Sea-Build via Truppen-Transportschiff (ungestört bauen)
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
- [ ] **Eigenes Icon** statt Verteidigungsposten-Platzhalter → siehe 0.1
- [ ] **Kein Stapeln, Mindestabstand** (0.5)
- [ ] **Umkreis + Auto-Verbindung** zu naher Wand als Wand-Linie (0.5, Straßen-
      Logik)
- [ ] Timer über der Wand beim Durchbrechen (Client)
- [ ] „Nur brechen, wenn kein Weg drumherum" (Pathfinding)
- [ ] Mobile-UI geprüft

---

## 4. Ölpumpen (Oil Pumps) + Öl-Ökonomie

- [x] Gebäude „Ölpumpe", Öl-Ressource, Verbrauch ∝ Größe, Startvorrat + Deckel
- [x] Produktion 250/Pumpe (deckt ~50k Kacheln); Baupfad erzeugt gezählte Pumpe
      (getestet)
- [x] Leerer Tank verlangsamt: Transport-/Handelsschiffe, Landangriffe, Züge
- [ ] Faktor auf **Kampfschiffe** (braucht Bewegungs-Gate im Warship)
- [x] Öl-Anzeige im HUD
- [ ] **Eigenes Icon** statt Fabrik-Platzhalter → siehe 0.1
- [ ] **Öl-Verbrauch beim Vergrößern** prüfen (0.4)
- [ ] Nur an validen Öl-Vorkommen platzierbar; Sea-Build im Meer
- [x] Mehrere Ölpumpen am selben Ort möglich
- [x] Bombe → Explosion in Pump-Radius-Größe (getestet)
- [ ] Mobile-UI geprüft

---

## 5. Input / UX

- [x] Zusatzbauten in der Schnellbau-Leiste (Wand/Ölpumpe/Zollstation)
- [x] Alt+1/2/3 wählt die Zusatzbauten
- [x] Shift+Mausrad bei aktivem Ghost = Stückzahl 1–25, gestapelt platzieren
- [x] Leiste bricht um (flex-wrap) statt abgeschnitten zu werden
- [ ] **Hotkey-Reihenfolge + Beschriftung** (0.3)
- [ ] **Mobile-Lösung für Mehrfachbau** (kein Shift+Rad auf dem Handy) — eigene
      Lösung überlegen (z. B. Mengen-Regler im Radial-/Baumenü)
- [ ] Prüfen, dass alle neuen Bau-Buttons auf dem **Handy** (Radial-Menü) da sind

---

## 6. Querschnitt / Infrastruktur

- [x] Klickbare Start-Datei (`start-game.bat`)
- [ ] Jedes Feature explizit auf **Mobile-UI** verifizieren
- [ ] Icons-Encoder-Skript als Tool ablegen (reproduzierbar)
