# Plan: Reale Karten importieren (OSM → spielbare Map)

Ziel (aus TODO §7): Im Karten-Editor eine **echte Weltkarte** zeigen, einen
**Bereich** wählen (z. B. Heimatstadt) und daraus eine **spielbare Map**
generieren. Daten nur aus **offen lizenzierten** Quellen (OpenStreetMap /
Natural Earth) — **nicht Google** (Lizenz passt nicht zur AGPL/CC-BY-SA-Linie).
Terrain-Typ soll der Realität folgen (Wüste/Wald/Gebirge), **Flüsse
durchgehend**.

Baut auf dem bestehenden Custom-Map-Stack auf: das Ergebnis ist ein
**Paint-Raster** (PaintTile-Werte, jetzt 6 Stufen) — danach greifen unverändert
`buildCustomTerrain` → `playCustomMapSolo` → speichern/veröffentlichen.

## Wichtige Vorab-Entscheidungen (bitte bestätigen)

1. **Datenquelle** (bestimmt Aufwand & Fidelity):
   - **Vektor (Overpass API)**: Küstenlinie, `natural=water`, `waterway=river`,
     `landuse=*`, `natural=wood/desert`. Offen (ODbL), kein API-Key. Rastern der
     Polygone/Linien nötig. Beste Typ-Treue, mehr Arbeit.
   - **Raster/DEM-Kacheln**: Höhe (terrain-RGB) + Landbedeckung pro Zelle
     sampeln → Magnitude-Bänder + Wasser. Einfacheres Rastern, braucht einen
     Kachel-Provider (teils API-Key/Nutzungslimit). Beste Höhe, gröberer Typ.
   - **Empfehlung:** stufenweise starten mit Vektor-Küstenlinie (Land/Wasser),
     Typen/Höhe später ergänzen.
2. **Online beim Erstellen?** Der Editor müsste beim Generieren Daten laden
   (Overpass/Kacheln). Gespielt wird danach **offline** aus dem Paint-Raster.
   OSM ist ODbL: das gerasterte, spielbare Ergebnis ist ein „produced work“ →
   **Namensnennung** („© OpenStreetMap contributors“) im Editor/Karte genügt;
   wir verteilen keine OSM-Rohdaten weiter.
3. **Provider für Overpass/Kacheln**: öffentlicher Overpass-Endpoint (rate-
   limitiert) vs. selbst gehostet. Für den Start: öffentlicher Endpoint mit
   kleinem Bbox-Limit + Caching.

## Pipeline (Bbox → Paint-Raster)

1. **Bbox wählen**: Editor zeigt eine echte Weltkarte (pan/zoom), Nutzer zieht
   ein Rechteck.
2. **Zielgröße**: Bbox → Rastergitter. **Deckelung ≤ ~2048 px pro Kante**
   (mobil-sicher, siehe unten „GPU-Limit“), Seitenverhältnis der Bbox erhalten.
3. **Fetch**:
   - Phase A: Küstenlinie/Wasserpolygone der Bbox.
   - Phase B: `landuse`/`natural` + optional DEM-Höhe.
4. **Projektion**: Web-Mercator (Kacheln) → gleichmäßiges Gitter. Bei kleinen
   Bboxen ist Verzerrung vernachlässigbar; sonst pro Zeile skalieren.
5. **Rastern** in PaintTile:
   - Wasser vs. Land aus Küstenlinie/Wasserpolygonen.
   - Höhe (DEM) → `Plains`/`Highland`/`Mountain`/`Peak` per Magnitude-Band.
   - Landbedeckung (Wüste/Wald) → passende Stufe (zunächst grob auf die 6
     vorhandenen Stufen gemappt; feinere Typen wären neue PaintTiles).
6. **Flüsse durchgehend** (Kern-Anforderung): `waterway=river/stream` als Linien
   mit Mindestbreite ins Raster brennen, dann **morphologisches Schließen**
   (dilate→erode) über Wasser, damit beim Rastern zerrissene Flüsse **verbunden**
   werden. Lieber durchziehen als Lücken lassen.
7. **Übergabe**: fertiges Paint-Raster landet im normalen Editor-Grid → Nutzer
   kann nachbessern → speichern / spielen / veröffentlichen (alles vorhanden).

## Editor-UI

- Neuer Modus im `map-editor-modal`: „Aus echter Karte“. Enthält eine
  Slippy-Map (pan/zoom) + Rechteck-Auswahl + „Generieren“.
- Nach dem Generieren zurück in den Paint-Editor mit dem erzeugten Raster.
- Attribution „© OpenStreetMap contributors“ sichtbar.

## Technische Risiken / offene Punkte

- **Overpass-Limits/Timeouts**: Bbox-Größe deckeln, Ergebnisse cachen, klare
  Fehlermeldung bei Timeout.
- **Basiskarten-Kacheln**: OSM-Tile-Server-Policy beachten (Volumen); ggf.
  ein freundlicher Style/Provider. Nur zum Anzeigen im Editor, nicht im Spiel.
- **GPU-Textur-Limit (frisch relevant!)**: Generierte Maps **≤ 4096, besser
  ≤ 2048** halten — größere Karten überschreiten das mobile `MAX_TEXTURE_SIZE`
  und rendern schwarz (genau der gerade gefixte Giant-World-Bug). Die
  Zielgröße-Deckelung in Schritt 2 verhindert das direkt.
- **Determinismus**: Rasterung passiert im Editor (Client), landet als fixes
  Paint-Raster — die Sim bleibt deterministisch, kein Problem.
- **Feinere Terrain-Typen** (echte Wüste/Wald als eigene Optik) bräuchten neue
  PaintTiles + Renderer-Farben; zunächst auf die 6 Stufen mappen.

## Phasen (klein → groß)

- **A — Land/Wasser** aus Küstenlinie für eine Bbox → sofort spielbar,
  gut verifizierbar (Rasterung als reine Funktion testbar).
- **B — Terrain-Typen** aus `landuse` + Höhenbändern.
- **C — Fluss-Durchgängigkeit** (morphologisches Schließen + Mindestbreite).
- **D — Basiskarten-UI** (Slippy-Map, Rechteck ziehen) statt Bbox-Eingabe.
