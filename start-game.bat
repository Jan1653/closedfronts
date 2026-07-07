@echo off
REM ClosedFronts - Doppelklick zum Starten des Spiels (Dev-Modus).
REM Startet Client + Server und oeffnet das Spiel im Standardbrowser.

cd /d "%~dp0"

if not exist "node_modules" (
  echo [ClosedFronts] Installiere Abhaengigkeiten, das dauert einmalig ein paar Minuten...
  call npm run inst
)

echo [ClosedFronts] Starte das Spiel... Das Browserfenster oeffnet sich gleich automatisch.
echo [ClosedFronts] Zum Beenden dieses Fenster schliessen oder Strg+C druecken.
call npm run dev

pause
