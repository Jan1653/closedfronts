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
- [ ] **Client:** Rendering der Station + der zwei „Straßen"-Verbindungen zu den Landmassen
- [ ] **Sea-Build (neu):** im Meer erst platzierbar, nachdem ein **Truppen-Transportschiff** (kein Handelsschiff) hinfährt und baut; es darf währenddessen **nicht abgeschossen** werden, sonst kein Bau
- [ ] **Phase 2 – Maut:** Gold-Maut im Boot-Pathfinding; Boote umfahren die Station, außer es ist der einzige Weg; **Feinde & Neutrale** zahlen Gold an den Besitzer; gilt für **Transport- UND Handelsschiffe**
- [ ] **Phase 3 – Verkettung:** neue Station an bestehende anhängen (Einweg-Verbindung), so über längere Strecken bauen
- [ ] Mobile-UI geprüft

---

## 2. Verteidigungsposten (Defense Post) — Umbau

- [ ] **Kosten verdoppeln** (2× aktueller Preis)
- [ ] **Upgradebar/stackbar:** pro Level steigt der **Radius** bis zu einem Limit
- [ ] **Pixel-Sperrfeuer bei Angriff:** feuert viele kleine „Mini-Granaten" (Pixel), **sehr schnell**; wo eine Granate explodiert, wird die getroffene Kachel **eingenommen**
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
