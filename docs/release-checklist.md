# Release-Checkliste

Vor einer Veröffentlichung:

1. `npm run verify` ausführen.
2. `index.html` im Browser öffnen.
3. Demo starten und Ergebnis ansehen.
4. Kleine Logdatei manuell hochladen und Preflight ausführen.
5. Analyse-Protokoll kopieren und JSON kurz prüfen.
6. README und `START_HIER.html` öffnen.
7. Sicherstellen, dass keine echten Logs im Repo liegen.
8. `serverstory-logs/` bleibt lokal und ist per `.gitignore` ausgeschlossen.
9. Bei neuen Report-Feldern Snapshot `tests/snapshots/analysis-report-v1.json` bewusst aktualisieren.
10. Bei neuen Parserformaten mindestens ein Fixture und einen Invariant-Test ergänzen.
11. `npm run build:release` ausführen.
12. `npm run audit:release` ausführen.
13. `npm run smoke:release` ausführen.
14. `npm run test:benchmark` ausführen, falls nicht schon über `npm run verify` passiert.
15. `npm run test:visual` ausführen, falls nicht schon über `npm run verify` passiert.
16. Release-ZIP prüfen: oben dürfen nur `START_HIER.html` und `serverstory-app/` sichtbar sein.
17. ZIP als einziges GitHub-Release-Asset hochladen; nicht den GitHub-Code-ZIP als Nutzerdownload bewerben.
18. Release-Text schlicht halten: ZIP herunterladen, entpacken, `START_HIER.html` öffnen, keine technischen Prüfinfos im Nutzertext.
19. Optional: `npm run publish:release -- vX.Y.Z` nutzt `gh`, prüft ZIP/Manifest lokal und lädt nur `serverstory.zip` hoch.
