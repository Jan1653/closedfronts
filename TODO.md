# ClosedFronts – TODO / Roadmap

Detaillierte Feature-Liste. Reihenfolge: **zuerst Water Toll Station fertig**, dann die neuen Features.

Querschnittsregel für ALLES: **muss auch auf der Handy-/Mobile-UI funktionieren.**

---

## 1. Water Toll Station (Zollstation) — _in Arbeit_

- [x] Core: neuer Typ `WaterTollStation`, Konfiguration (Kosten/Bauzeit/HP)
- [x] Platzierung nur auf Wasser zwischen **zwei Landmassen** im Radius
- [x] Kapern durch feindliches Kampfschiff (Nähe-Timer, unterbrechbar)
- [x] Core-Tests (Platzierung positiv/negativ, Kapern)
- [x] **Client:** Build-Menü-Eintrag (Icon + Beschriftung)
- [x] **Client:** Radius-Vorschau beim Platzieren (man sieht den Umkreis)
- [x] **Client:** Station auf der Karte sichtbar (vorerst Port-Platzhalter-Icon; eigenes Icon braucht Atlas-Neugenerierung)
- [ ] **Client:** die zwei „Straßen"-Verbindungslinien zu den Landmassen zeichnen
- [ ] **Sea-Build (neu):** im Meer erst platzierbar, nachdem ein **Truppen-Transportschiff** (kein Handelsschiff) hinfährt und baut; es darf währenddessen **nicht abgeschossen** werden, sonst kein Bau
- [x] **Phase 2a – Maut kassieren:** **Feinde & Neutrale** zahlen beim Durchfahren einmalig Gold an den Besitzer; eigene/verbündete Boote frei; gilt für **Transport- UND Handelsschiffe** (getestet)
- [ ] **Phase 2b – Umgehung:** Boote umfahren die Station im Pathfinding, außer es ist der einzige Weg (Aufpreis-Ebene im Wasser-A\*)
- [ ] **Phase 3 – Verkettung:** neue Station an bestehende anhängen (Einweg-Verbindung), so über längere Strecken bauen
- [ ] Mobile-UI geprüft

---

## 2. Verteidigungsposten (Defense Post) — Umbau

- [x] **Kosten verdoppeln** (2× aktueller Preis)
- [x] **Upgradebar/stackbar:** pro Level steigt der **Radius** bis zu einem Limit (30 → 60, getestet)
- [x] **Pixel-Sperrfeuer (Mechanik):** der Posten nimmt schnell die nächsten Feind-Kacheln **und Wildnis** im Radius ein — „wo es explodiert, wird eingenommen" (getestet)
- [ ] **Pixel-Sperrfeuer (Optik):** die kleinen Granaten-Projektile sichtbar fliegen lassen (Client-Rendering, Nachtrag)
- [ ] Balancing: viele Posten nebeneinander = starke, kaum durchdringbare Front
- [ ] Mobile-UI geprüft

---

## 3. Wände (Walls)

- [x] Baubar (Einzelkachel via Build-Menü) + auf der Karte sichtbar (Platzhalter-Icon)
- [ ] Als **Linie „ziehbar"** (drag-to-draw über mehrere Kacheln) — Nachtrag (Client)
- [x] Übernehmbar (wer die Kachel hält, bekommt die Wand)
- [x] **Sehr schwer zu durchbrechen:** 50× Angriffskosten auf einer Wand-Kachel (getestet)
- [x] Leichter zu durchbrechen mit **Verteidigungsposten-Granaten** (kapern die Kachel) oder einer **Bombe** (Nuke zerstört Strukturen)
- [ ] **Timer über der Wand** anzeigen, während sie durchbrochen wird — Nachtrag (Client)
- [ ] „Nur brechen, wenn kein Weg drumherum — sonst Boot senden" — Nachtrag (Pathfinding)
- [ ] Mobile-UI geprüft

---

## 4. Ölpumpen (Oil Pumps) + Öl-Ökonomie

- [x] Neues Gebäude „Ölpumpe" (an Land baubar, auf der Karte sichtbar via Platzhalter-Icon)
- [x] **Öl-Ressource:** Pumpen produzieren, **Verbrauch steigt mit Spielergröße**, Startvorrat + Deckel (getestet)
- [x] **Öl leer → Verlangsamungs-Faktor** (`oilSpeedFactor`) vorhanden (getestet)
- [x] Faktor auf **Transportschiffe** angewandt (leerer Tank = langsamer; getestet)
- [x] Faktor auf **Landangriffe** angewandt (leerer Tank = Angriff erobert Kacheln langsamer; getestet)
- [x] Faktor auf **Handelsschiffe** angewandt (leerer Tank = seltenere Schritte; getestet)
- [x] Faktor auf **Züge** zwischen Fabriken angewandt (leerer Tank = weniger Kacheln/Tick, min. 1; getestet)
- [ ] Faktor auf **Kampfschiffe** — Nachtrag (Warship bewegt sich pro Tick direkt ohne `ticksPerStep`, braucht Bewegungs-Gate)
- [x] **Öl-Anzeige im HUD** neben Gold (im Spiel verifiziert)
- [ ] Nur an **validen Öl-Vorkommen** (Land) platzierbar — Nachtrag
- [ ] Auch **im Meer** an Meer-Vorkommen + **Sea-Build** (Truppenschiff fährt hin, baut ungestört) — Nachtrag
- [x] **Mehrere Ölpumpen am selben Ort** möglich (eigene Platzierung ohne Abstandsregel; getestet)
- [x] Ölpumpe von einer **Bombe getroffen → Explosion in Pump-Radius-Größe** (`oilPumpRadius`): zerstört Units + Land-Krater im Radius, kettet nicht (getestet)
- [ ] Mobile-UI geprüft

---

## 5. Querschnitt / Infrastruktur

- [x] Klickbare Start-Datei zum Testen (`start-game.bat`)
- [ ] Jedes Feature zusätzlich explizit auf **Mobile-UI** verifizieren
