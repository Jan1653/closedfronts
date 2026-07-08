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
- [x] **Pixel-Sperrfeuer (Mechanik):** der Posten nimmt bei Feindkontakt schnell die nächsten Feind-Kacheln im Radius ein — „wo es explodiert, wird eingenommen" (getestet)
- [ ] **Pixel-Sperrfeuer (Optik):** die kleinen Granaten-Projektile sichtbar fliegen lassen (Client-Rendering, Nachtrag)
- [ ] Balancing: viele Posten nebeneinander = starke, kaum durchdringbare Front
- [ ] Mobile-UI geprüft

---

## 3. Wände (Walls)

- [ ] Baubar und als **Linie „ziehbar"** (drag-to-draw über mehrere Kacheln)
- [ ] Übernehmbar (Besitzwechsel wie andere Strukturen)
- [ ] **Sehr schwer zu durchbrechen:** braucht sehr viele Truppen — soll sich wirklich schwer anfühlen
- [ ] Leichter zu durchbrechen mit: **Verteidigungsposten-Granaten** oder einer **Bombe** darauf
- [ ] Normales Durchbrechen per Klick möglich, aber **langsam** (dauert)
- [ ] **Timer über der Wand** anzeigen, während sie durchbrochen wird
- [ ] Wand nur durchbrechen, wenn das angeklickte Ziel **wirklich nur hinter der Wand** erreichbar ist. Gibt es einen Weg drumherum (z. B. Wasser), stattdessen **ein Boot senden** statt die Wand zu brechen
- [ ] Mobile-UI geprüft

---

## 4. Ölpumpen (Oil Pumps) + Öl-Ökonomie

- [ ] Neues Gebäude „Ölpumpe"; nur an **bestimmten validen Orten** (Öl-Vorkommen) an Land platzierbar
- [ ] Auch **im Meer** an validen Meer-Vorkommen platzierbar
- [ ] Sea-Build wie bei der Zollstation: Truppen-Transportschiff fährt hin und baut ungestört
- [ ] **Mehrere Ölpumpen am selben Ort** möglich
- [ ] Effekt: erhöht die **Geschwindigkeit aller Schiffstypen**
- [ ] Effekt: erhöht die **Geschwindigkeit der Züge/Busse** zwischen Fabriken
- [ ] **Neue Öl-Anzeige** (wie die Gold-Anzeige)
- [ ] **Öl-Verbrauch steigt mit Spielergröße** (je größer, desto mehr Öl nötig)
- [ ] **Öl leer → alles läuft sehr langsam**
- [ ] Ölpumpe von einer **Bombe getroffen → große Explosion** in Größe einer Wasserstoffbombe
- [ ] Mobile-UI geprüft

---

## 5. Querschnitt / Infrastruktur

- [x] Klickbare Start-Datei zum Testen (`start-game.bat`)
- [ ] Jedes Feature zusätzlich explizit auf **Mobile-UI** verifizieren
