# Repository guidance

## Projektregeln
- Antworte dem Nutzer immer auf Deutsch.
- Verändere bestehendes Verhalten nur, wenn der Nutzer dies ausdrücklich beauftragt.
- Committe oder pushe niemals ohne ausdrückliche Freigabe des Nutzers für die jeweilige Aktion.
- Führe vor Änderungen zuerst passende Tests bzw. Prüfungen des Ist-Zustands durch und halte vorhandene Fehler fest.

## Laufende Kommunikation und nächste Schritte
- Nach jedem abgeschlossenen Auftrag verständlich zusammenfassen: Was ist das Ergebnis, was bedeutet es praktisch für den Nutzer und welcher konkrete nächste Schritt wird empfohlen? Technische Prüfergebnisse allein reichen nicht; automatisierte Prüfung und Bestätigung am echten Zielsystem unterscheiden.
- Benötigt der nächste Schritt eine Entscheidung, Freigabe oder einen Zielsystemtest durch den Nutzer, exakt benennen, was er entscheiden bzw. am Gerät tun soll und welches Ergebnis erwartet wird. Voraussetzungen wie ein noch zu installierender Testbuild offen nennen.
- Nach der Empfehlung auf die Antwort warten; nicht stillschweigend den nächsten Entwicklungspunkt beginnen. Die Nachricht `asdf` beauftragt genau den zuletzt konkret vorgeschlagenen nächsten Schritt, keine darüber hinausgehende Weiterarbeit. Commit und Push bleiben an ihre ausdrückliche Freigabe gebunden.
- Rückfragen nur stellen, wenn eine tatsächlich erforderliche Entscheidung nicht aus Projektkontext, Code oder `AGENTS.md` hervorgeht. Vorhandene Informationen selbst ermitteln, statt den Nutzer den Entwicklungsablauf organisieren zu lassen.
- Auf Deutsch wie in einem normalen Chat kommunizieren. Verfügbare technische Arbeitsschritte einschließlich Tests und Reviews selbst übernehmen; den Nutzer nicht unnötig zwischen Browser und Terminal wechseln lassen. Erforderliche Bedienung des echten Zielsystems hier mit konkreten Schritten begleiten und die Beobachtungen im Chat entgegennehmen.
- Vorbereitete Testbuilds im Rahmen des beauftragten Zielsystemtests künftig selbstständig auf dem erreichbaren Zielsystem installieren. Den vorhandenen Decky-Installationsweg nutzen, Rückkehrpaket bereithalten und anschließend installierte Dateien sowie tatsächlich geladene Version prüfen. Den Nutzer nur bei fehlendem Zugriff oder einer wirklich erforderlichen Entscheidung einbeziehen; sichtbare HDR-Ergebnisse am Display lässt er im Chat bestätigen.

## Automatischer Vieraugen-Workflow
- Nach jedem Implementierungspunkt und erfolgreichen eigenen Tests selbstständig einen unabhängigen Review mit `claude -p` im Repository starten. Der Reviewer bleibt read-only im Plan Mode und startet keine weiteren Reviewer. Keine Freigabe zum Implementieren, Committen oder Pushen daraus ableiten.
- Im Review-Prompt Auftrag, betroffenen Punkt, volle Basis-Commit-SHA und Vergleich **Basis → aktueller Worktree** nennen. Für Phase 1 Punkt 1 ist die Basis `v0.4.19`, Commit `de2ec617183a4c4a4f36e2201f0e1eb5dd231105`. Frühere uncommittete Änderungen gegebenenfalls zusätzlich durch einen benannten Snapshot abgrenzen. Eigene Prüfergebnisse mitgeben, aber eine unabhängige Prüfung verlangen.
- `git diff` enthält keine untracked Dateien: immer zusätzlich `git --no-optional-locks status --short --untracked-files=all` und `git ls-files --others --exclude-standard` prüfen lassen; relevante untracked Dateien (insbesondere Tests) ausdrücklich per `Read` einbeziehen. Nicht nur Diff-Zusammenfassungen reviewen.
- Mit `claude --help` verifiziert und harmlos getestet (2.1.288): Als Werkzeuge genügen `Read,Bash`, mit Freigaben nur für `Read` und die unten exakt aufgeführten Befehle. Testskripte vor Freigabe auf Schreib-/Netzwerkseiteneffekte prüfen; keine pauschale `Bash(*)`-Freigabe. Der Reviewer führt keinen Build aus, da dieser `dist/` verändert. Bei CLI-Änderungen Hilfe und harmlosen Test wiederholen.

```bash
BASE=de2ec617183a4c4a4f36e2201f0e1eb5dd231105 # je Auftrag explizit setzen
timeout --signal=TERM --kill-after=10s 600s claude -p "$REVIEW_PROMPT" \
  --permission-mode plan --permission-prompts none --tools 'Read,Bash' \
  --allowedTools 'Read' \
    'Bash(git --no-optional-locks status --short --untracked-files=all)' \
    'Bash(git ls-files --others --exclude-standard)' \
    "Bash(git diff --no-ext-diff --no-textconv $BASE --)" \
    'Bash(pnpm test)' 'Bash(pnpm exec tsc --noEmit --skipLibCheck)' \
  --disallowedTools 'Edit,Write,NotebookEdit,ExitPlanMode,Agent,Task' \
  --setting-sources '' --settings '{"disableAllHooks":true}' \
  --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --disable-slash-commands --no-session-persistence --output-format json --verbose
```

- Für den harmlosen Funktionstest reichen 180 Sekunden und Status/Diff, Lesen einer relevanten untracked Datei sowie der freigegebene Testlauf. Beim eigentlichen Review 600 Sekunden und einen etwas längeren äußeren Tool-Timeout verwenden; Protokolle bei Bedarf unter `/tmp/opencode/` speichern. Exitstatus, JSON-Fehler, tatsächliche Tool-Aufrufe und `permission_denials` prüfen; Timeout oder verweigerte notwendige Prüfungen sind kein erfolgreicher Review.
- Claude soll konkrete Befunde mit Schweregrad, Datei/Zeile, Reproduktionsweg und Testlücken melden sowie verbleibende Prüfgrenzen nennen. Jeden Befund selbst am Code bzw. durch Regressionstests verifizieren. Nur beauftragte notwendige Korrekturen umsetzen, danach eigene Tests und unabhängigen Review erneut ausführen. Befunde und deren Auflösung abschließend zusammenfassen.

## Build and verification
- Use `pnpm install`, then `pnpm run build`; `pnpm run watch` rebuilds the frontend. Rollup emits generated files into ignored `dist/` and clears its contents on build.
- Focused frontend check: `pnpm exec tsc --noEmit --skipLibCheck`. Plain `pnpm exec tsc --noEmit` currently fails in dependency declarations on missing `react-router` and `JSX`; the focused check skips dependency declarations.
- `pnpm test` runs the Auto-HDR toggle regressions with Node and Python 3 (standard-library `unittest`, `-B` prevents bytecode writes). Focused commands: `node --test tests/auto-hdr-toggle.test.mjs` and `python3 -B -m unittest discover -s tests -p 'test_auto_hdr_toggle.py'`. Tests use the real frontend/backend with mocked host APIs and settings writes. There is no configured lint command.
- Prefer the direct pnpm commands for local builds: the VS Code `build` task runs setup that upgrades `@decky/ui --latest`, then invokes a sudo-based Decky CLI build.
- Runtime verification requires Decky Loader inside Linux Steam Game Mode with working Gamescope/HDR. React, ReactDOM, and Decky UI are supplied as host globals by `@decky/rollup`; this is not a standalone browser app.

## Actual execution paths
- `src/index.tsx` contains the frontend and plugin-wide runtimes. Start/stop subscriptions and patches in `definePlugin` / `onDismount`, not in the settings panel lifecycle: launch handling must survive closing the panel.
- The real backend is `main.py`'s `Plugin`, reached through named `callable` RPCs in `src/index.tsx`. Keep RPC names, argument order, and frontend result/settings types aligned. `backend/` is a C Hello World scaffold, not the HDR backend; `decky.pyi` is only a typing stub for the host-provided module.
- Active PCGamingWiki resolution is `get_hdr_info` → `_resolve_sync` → `pcgw_helper.py`, despite older lookup/parser methods also present in `main.py`. Preserve the helper's system Python `-I` invocation and environment sanitization: inherited Decky Python/loader variables can break HTTPS. Helper stdout must remain JSON; diagnostics go to stderr.
- Settings live under `decky.DECKY_PLUGIN_SETTINGS_DIR`; compatibility and curator caches live under `decky.DECKY_PLUGIN_RUNTIME_DIR`, not the source tree.

## Behavior to preserve
- `applyCachedHdrForLaunch` reads the frontend `pcgwLaunchCache` only. Never call `get_hdr_info` there: a backend cache miss performs network lookups. Only `hdr == "true"` enables HDR by default; missing data and `hackable` default to SDR. Override inverts the launch decision without changing compatibility badges.
- The first Steam START event wins for a launch cycle. `GameActionEnd` means launch-action completion, not game exit; restoration uses app-lifetime notifications.
- Automatic switching/restoration uses `setSteamHdrPluginLevel` and Steam's `gamescope_hdr_enabled` setting through a private Webpack module. Backend `gamescopectl` methods are a separate path; check the frontend call sites before changing HDR control.
- PCGamingWiki title-search fallback must validate the exact Steam AppID. Curator fallback must not downgrade native PCGamingWiki HDR or treat Windows Auto HDR as native support.

## v0.4.20 Development Plan

### Verifizierte Ausgangslage und Vorgehen
- Ausgangsbasis vor Phase 1 war Tag `v0.4.19` (`de2ec61`), ohne automatisierte Regressionstests. Build, `tsc --noEmit --skipLibCheck` und Python-AST-Prüfung von `main.py`/`pcgw_helper.py` bestanden.
- Punkt 1 wurde ausdrücklich zur Umsetzung freigegeben; Punkte 2–7 bleiben Plan. Vor jedem Fix passende Regressionstests anlegen, den Fehler am Ausgangsstand nachweisen und anschließend den Fix prüfen. Netzwerk, Decky-RPCs und Steam-Laufzeit dabei kontrolliert simulieren; HDR-Zugriff zusätzlich im Zielsystem verifizieren. Keine beiläufige Dead-Code-Entfernung oder sonstigen Refactorings.

### Phase 1
1. **Auto-HDR-Toggle sofort wirksam machen.** `changeAutoHdr` in `src/index.tsx` aktualisiert UI und Persistenz, aber nicht `runtimeAutoHdrEnabled`; dessen Laden erfolgt beim Pluginstart. Runtime-State unmittelbar beim Umschalten synchronisieren, bei Speicherfehlern konsistent zurücksetzen. Regressionen: Ein/Aus mit sofort folgendem Spielstart, RPC-Fehler, schnelles Umschalten und verspätete initiale Settings-Antwort.
   - Umgesetzt: sofortiger Runtime-/UI-Abgleich, geordnete Schreibzugriffe mit Revisionsschutz, Rücksetzen auf den zuletzt bestätigten Wert und Synchronisierung wieder geöffneter Panels. Nachweis vor dem Fix: 2 Basistests bestanden, 11 Regressionstests scheiterten am unveränderten v0.4.19-Frontend; danach bestehen alle 13 Tests sowie Build und fokussierter TypeScript-Check.
   - Vieraugen-Review: Backend-Rollback bei Speicherfehlern und Schutz des Auto-HDR-Felds vor Antworten anderer Settings-RPCs zusätzlich per fehlschlagenden Tests nachgewiesen und korrigiert. Aktuell bestehen 23 Node-Tests und 3 Python-Testmethoden, TypeScript-Check und Build; Claudes zweiter read-only Review bestätigt beide Korrekturen ohne offene hoch-/mittelschwere Befunde. Inhalts-Hashes aller getrackten/untracked Dateien blieben während beider Reviews unverändert.
   - Reale Laufzeitprüfung abgeschlossen: Testbuild `0.4.20-phase1-point1.1` wurde über Decky 3.2.8 installiert, Backend/Frontend und Paketdateien verifiziert; der Nutzer bestätigte den vollständigen Game-Mode-Test einschließlich unmittelbarer Toggle-Wirkung und HDR-Restore als erfolgreich. Punkt 1 ist damit abgeschlossen.
   - Resthinweise ohne Blocker: Ein später initialer Lesefehler ohne Toggle deaktiviert Auto-HDR bereits in v0.4.19 (kein erzwungenes SDR); Toasts pro Klick bleiben erhalten. RPC-Timeout/Verbindungsabbruch nach möglichem Backend-Erfolg ist lokal nicht vollständig simulierbar; der installierte `@decky/api`-Wrapper delegiert an den Host und belegt dessen Timeout-Verhalten nicht.
2. **Persistenten HDR-Cache direkt beim Start nutzen.** `Plugin._main` lädt den persistenten Cache, `applyCachedHdrForLaunch` sieht jedoch nur die anfangs leere Frontend-Map. Einen rein lokalen Cache-Zugriff per RPC vorsehen, damit ein Start vor abgeschlossenem Preload vorhandene gültige Einträge nutzen kann. Nicht `get_hdr_info` verwenden: dessen Cache-Miss startet Netzwerkzugriffe. Regressionen: leere Frontend-Map bei vorhandenem persistentem Treffer, fehlender/abgelaufener Eintrag und RPC-Fehler; auf allen Launch-Pfaden null Netzwerkzugriffe. Cacheformat und bestehende TTL-Regeln erhalten (HDR 30 Tage, Curator 7 Tage); kein stiller Wechsel zur Nutzung abgelaufener Daten.
3. **Unsupported Non-Steam-Games ausnehmen.** `probableSteamGameId` übernimmt das zweite START-Argument; der Launch-Pfad prüft bisher nur leer/`"-"`, nicht den Spieltyp. Vor HDR-Änderung und Restore-Kontext zuverlässig reguläre Steam-Spiele erkennen; numerische IDs allein sind kein Nachweis. Die tatsächlichen Steam-Metadaten/Eventformen vor Festlegung der Erkennung prüfen. Regressionen: Non-Steam-Shortcut verändert HDR auch mit Cache/Override nicht und erzeugt keinen Restore; reguläre Steam-Spiele behalten ihr Verhalten. Fehlende/uneindeutige Metadaten explizit abdecken; echte Non-Steam-Unterstützung gehört nicht zu Phase 1.
4. **PCGW-AppID zwingend bestätigen.** Im aktiven `pcgw_helper.py` umgehen exakte Titeltreffer, Ähnlichkeitstreffer (Schwelle `0.82`) und Redirects die AppID-Prüfung; `resolve` prüft ebenfalls nicht nach. Jeder akzeptierte Treffer für ein reguläres Steam-Spiel muss durch die Steam-AppID auf der PCGW-Seite bestätigt sein. `page_mentions_appid` sucht bislang nur eine Zahl im gesamten Wikitext: Bestätigung über Steam-bezogene Seitenangaben verifizieren. Regressionen für alle Auflösungswege: passende/falsche/fehlende AppID, Zahlen-Teiltreffer, zufällige Zahlen und nicht lesbare Seite; Titelgleichheit allein genügt nie.
5. **Curator vollständig paginieren.** `_fetch_steam_hdr_curator_sync` ruft bisher nur `start=0,count=100` ab. Antwortfelder und Endbedingungen prüfen, dann alle Seiten zusammenführen. Regressionen: über 100 Einträge, letzte/ leere Seite, Duplikate, ausbleibender Fortschritt und Fehler auf Folgeseiten; kein Endloslauf und kein unvollständiges Ergebnis als vollständig erneuerter persistenter Cache.
6. **Quelle nur bei Informationsgewinn ändern.** `_apply_steam_hdr_curator_fallback_sync` überschreibt bei jedem Curator-`workaround` die Quelle. PCGW `hackable` + Curator `workaround` muss `hackable` mit Quelle `PCGamingWiki` bleiben. Curator übernimmt nur bei zusätzlicher Information: etwa unbekannt/negativ → Workaround oder nicht-nativ → nativ. Regressionen als Status-/Quellenmatrix einschließlich `source_detail`, unverändertem PCGW-Nativbefund und Windows Auto HDR ohne native Aufwertung.
7. **Steam-HDR-Zugriff erst untersuchen, dann robust ersetzen.** Start und Restore verwenden `setSteamHdrPluginLevel` mit festem `33867.qt`. Im installierten Stand (`@decky/api` 1.1.3, `@decky/ui` 4.11.0) exportiert `@decky/ui` u. a. `findModule`, `findModuleExport` und `findModuleDetailsByExport`; ein dedizierter HDR-Setter ist in `@decky/api` nicht ausgewiesen. Vor Änderung Funktionssignatur, Bindung und Wirkung des echten Setters in der aktuellen Steam-/Decky-Laufzeit untersuchen. Erst dann eine mit dieser API verifizierte Erkennung ohne feste Modul-ID/minifizierten Exportnamen einsetzen; keine erfundene API oder bloße Namensheuristik. Regressionen: geänderte IDs/Exports, fehlende/mehrdeutige Treffer, Setter-Fehler sowie Start und Restore; bei unklarer Erkennung keinen fremden Setter aufrufen. Die konkrete Erkennung ist noch nicht verifiziert.

### v0.4.19-Regressionsschutz
- Außer den ausdrücklich geplanten Korrekturen bewahren: Detail-/Mini-Badges samt Home-/Library-Schaltern, installierte/nicht installierte Steam-Titel, Override als reine Entscheidungsumkehr und dessen Persistenz, erster START pro Launch-Zyklus sowie einmaliges Restore erst bei App-Ende, nicht bei `GameActionEnd`.
- Cachetreffer, Lazy-Lookups und manuelles Refresh samt Queue-Reset erhalten. Library-Delta verarbeitet nur neue AppIDs, ohne bestehende Einträge erneut abzufragen. Toast-Verhalten am Code charakterisieren: Cache-only ohne Lade-Toasts, Netzwerk-Start/Abschluss, Desktop-Unterdrückung und Wechsel in Game Mode während laufendem Preload. Diese Abläufe vor Änderungen durch Regressionstests absichern; Badge-/Toast-/HDR-Integration ergänzend im Zielsystem prüfen.
