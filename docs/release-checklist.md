# Release-Checkliste

Vor einer Veroeffentlichung:

1. `npm run verify` ausfuehren.
2. `index.html` im Browser oeffnen.
3. Demo starten und Ergebnis ansehen.
4. Kleine Logdatei manuell hochladen und Preflight ausfuehren.
5. Analyse-Protokoll kopieren und JSON kurz pruefen.
6. README und `START_HIER.html` oeffnen.
7. Sicherstellen, dass keine echten Logs im Repo liegen.
8. `serverstory-logs/` bleibt lokal und ist per `.gitignore` ausgeschlossen.
9. Bei neuen Report-Feldern Snapshot `tests/snapshots/analysis-report-v1.json` bewusst aktualisieren.
10. Bei neuen Parserformaten mindestens ein Fixture und einen Invariant-Test ergaenzen.
11. `npm run build:release` ausfuehren.
12. `npm run audit:release` ausfuehren.
13. `npm run smoke:release` ausfuehren.
14. `npm run test:benchmark` ausfuehren, falls nicht schon ueber `npm run verify` passiert.
15. Release-ZIP pruefen: oben duerfen nur `START_HIER.html` und `serverstory-app/` sichtbar sein.
16. `dist/serverstory-release-manifest.json` mit ZIP-Groesse und SHA256 zum Release legen.
17. ZIP als GitHub-Release-Asset hochladen; nicht den GitHub-Code-ZIP als Nutzerdownload bewerben.
