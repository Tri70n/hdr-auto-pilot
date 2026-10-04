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
- Mit `claude --help` verifiziert und harmlos getestet (2.1.288): Als Werkzeuge genügen `Read,Bash`; `--permission-mode plan` hält den Reviewer read-only. Die unten aufgeführten Befehle freigeben und Testskripte vorher auf Schreib-/Netzwerkseiteneffekte prüfen. Plan Mode kann zusätzliche read-only Shellbefehle (z. B. `grep`) selbst erlauben; tatsächliche Tool-Aufrufe deshalb kontrollieren. Werden nur geklammerte Bash-Tools über `--tools` angegeben, stellt diese CLI-Version Bash gar nicht bereit. Der Reviewer führt keinen Build aus, da dieser `dist/` verändert. Bei CLI-Änderungen Hilfe und harmlosen Test wiederholen.

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
- `pnpm test` runs the Auto-HDR toggle and launch-cache regressions with Node and Python 3 (standard-library `unittest`, `-B` prevents bytecode writes). Focused commands: `node --test tests/auto-hdr-toggle.test.mjs` and `python3 -B -m unittest discover -s tests -p 'test_*.py'`. Tests use the real frontend/backend with mocked host APIs, network access, and settings writes. There is no configured lint command.
- Prefer the direct pnpm commands for local builds: the VS Code `build` task runs setup that upgrades `@decky/ui --latest`, then invokes a sudo-based Decky CLI build.
- Runtime verification requires Decky Loader inside Linux Steam Game Mode with working Gamescope/HDR. React, ReactDOM, and Decky UI are supplied as host globals by `@decky/rollup`; this is not a standalone browser app.

## Actual execution paths
- `src/index.tsx` contains the frontend and plugin-wide runtimes. Start/stop subscriptions and patches in `definePlugin` / `onDismount`, not in the settings panel lifecycle: launch handling must survive closing the panel.
- The real backend is `main.py`'s `Plugin`, reached through named `callable` RPCs in `src/index.tsx`. Keep RPC names, argument order, and frontend result/settings types aligned. `decky.pyi` is only a typing stub for the host-provided module.
- Active PCGamingWiki resolution is `get_hdr_info` → `_resolve_sync` → `pcgw_helper.py`; `_resolve_sync` launches the helper through system Python with `-I`, after which `main.py` applies the Steam HDR Curator fallback and persists the result. Preserve this isolated helper invocation and its environment sanitization: inherited Decky Python/loader variables can break HTTPS. Helper stdout must remain JSON; diagnostics go to stderr.
- Settings live under `decky.DECKY_PLUGIN_SETTINGS_DIR`; compatibility and curator caches live under `decky.DECKY_PLUGIN_RUNTIME_DIR`, not the source tree.

## Behavior to preserve
- `applyCachedHdrForLaunch` uses the frontend `pcgwLaunchCache`, then the backend's cache-only `get_cached_hdr_info` RPC on a map miss. Never call `get_hdr_info` there: its backend cache miss performs network lookups. Only `hdr == "true"` enables HDR by default; missing data and `hackable` default to SDR. Override inverts the launch decision without changing compatibility badges.
- The first Steam START event wins for a launch cycle. `GameActionEnd` means launch-action completion, not game exit; restoration uses app-lifetime notifications.
- Automatic switching/restoration uses `setSteamHdrPluginLevel` and Steam's `gamescope_hdr_enabled` setting through a private Webpack module. Backend `gamescopectl` methods are a separate path; check the frontend call sites before changing HDR control.
- PCGamingWiki title-search fallback currently accepts exact and similarity title matches without mandatory AppID confirmation; this is deferred post-v0.4.20 and must not be described as implemented. Curator fallback must not downgrade native PCGamingWiki HDR or treat Windows Auto HDR as native support.

## v0.4.20 Release Record

### Verifizierte Ausgangslage und Vorgehen
- Ausgangsbasis vor Phase 1 war Tag `v0.4.19` (`de2ec61`), ohne automatisierte Regressionstests. Build, `tsc --noEmit --skipLibCheck` und Python-AST-Prüfung von `main.py`/`pcgw_helper.py` bestanden.
- Der Releaseumfang wurde nach Punkt 1 und Punkt 2 geschlossen. Beide Punkte sind automatisiert, unabhängig und auf dem realen Bazzite-/Decky-Zielsystem geprüft. Frühere Punkte 3–7 gehören nicht zu v0.4.20 und dürfen für diesen Release nicht mehr begonnen werden.

### Phase 1
1. **Auto-HDR-Toggle sofort wirksam machen.** `changeAutoHdr` in `src/index.tsx` aktualisiert UI und Persistenz, aber nicht `runtimeAutoHdrEnabled`; dessen Laden erfolgt beim Pluginstart. Runtime-State unmittelbar beim Umschalten synchronisieren, bei Speicherfehlern konsistent zurücksetzen. Regressionen: Ein/Aus mit sofort folgendem Spielstart, RPC-Fehler, schnelles Umschalten und verspätete initiale Settings-Antwort.
   - Umgesetzt: sofortiger Runtime-/UI-Abgleich, geordnete Schreibzugriffe mit Revisionsschutz, Rücksetzen auf den zuletzt bestätigten Wert und Synchronisierung wieder geöffneter Panels. Nachweis vor dem Fix: 2 Basistests bestanden, 11 Regressionstests scheiterten am unveränderten v0.4.19-Frontend; danach bestehen alle 13 Tests sowie Build und fokussierter TypeScript-Check.
   - Vieraugen-Review: Backend-Rollback bei Speicherfehlern und Schutz des Auto-HDR-Felds vor Antworten anderer Settings-RPCs zusätzlich per fehlschlagenden Tests nachgewiesen und korrigiert. Aktuell bestehen 23 Node-Tests und 3 Python-Testmethoden, TypeScript-Check und Build; Claudes zweiter read-only Review bestätigt beide Korrekturen ohne offene hoch-/mittelschwere Befunde. Inhalts-Hashes aller getrackten/untracked Dateien blieben während beider Reviews unverändert.
   - Reale Laufzeitprüfung abgeschlossen: Testbuild `0.4.20-phase1-point1.1` wurde über Decky 3.2.8 installiert, Backend/Frontend und Paketdateien verifiziert; der Nutzer bestätigte den vollständigen Game-Mode-Test einschließlich unmittelbarer Toggle-Wirkung und HDR-Restore als erfolgreich. Punkt 1 ist damit abgeschlossen.
   - Resthinweise ohne Blocker: Ein später initialer Lesefehler ohne Toggle deaktiviert Auto-HDR bereits in v0.4.19 (kein erzwungenes SDR); Toasts pro Klick bleiben erhalten. RPC-Timeout/Verbindungsabbruch nach möglichem Backend-Erfolg ist lokal nicht vollständig simulierbar; der installierte `@decky/api`-Wrapper delegiert an den Host und belegt dessen Timeout-Verhalten nicht.
2. **Persistenten HDR-Cache direkt beim Start nutzen.** `Plugin._main` lädt den persistenten Cache, `applyCachedHdrForLaunch` sieht jedoch nur die anfangs leere Frontend-Map. Einen rein lokalen Cache-Zugriff per RPC vorsehen, damit ein Start vor abgeschlossenem Preload vorhandene gültige Einträge nutzen kann. Nicht `get_hdr_info` verwenden: dessen Cache-Miss startet Netzwerkzugriffe. Regressionen: leere Frontend-Map bei vorhandenem persistentem Treffer, fehlender/abgelaufener Eintrag und RPC-Fehler; auf allen Launch-Pfaden null Netzwerkzugriffe. Cacheformat und bestehende TTL-Regeln erhalten (HDR 30 Tage, Curator 7 Tage); kein stiller Wechsel zur Nutzung abgelaufener Daten.
   - Implementiert und im Zielsystem bestätigt: `get_cached_hdr_info` nutzt nur den geladenen persistenten Cache und dieselbe 30-Tage-TTL. Der Launch übernimmt Treffer ohne Netzwerk und bleibt bei Miss/Fehler SDR; Overrides und Restore bleiben erhalten. Launch-Token, Runtime-Recheck und Cache-Revision verhindern verspätete Änderungen nach App-Ende, Auto-HDR-Aus, Plugin-Unload, neuerem Start oder Cache-Clear. Vor dem Fix scheiterten 5 Frontendfälle und 6 Backendprüfungen; die erste Review-Race-Lücke sowie ein parallel gefüllter Frontend-Cache wurden jeweils vor ihrer Korrektur durch fehlschlagende Tests nachgewiesen.
   - Vieraugen-Review abgeschlossen: 37 Node-Tests, 7 Python-Testmethoden, TypeScript-Check und Build bestehen; Claudes abschließender read-only Review führte Tests und TypeScript selbst aus und meldete keine relevanten offenen Befunde. Bekannte vorbestehende Probleme des manuellen Cache-Clear und laufender Warmup-Abfragen gehören nicht zu Punkt 2 und wurden nicht beiläufig verändert.
   - Reale Laufzeitprüfung abgeschlossen: Testbuild `0.4.20-phase1-point2.1` wurde über Decky installiert und Backend, Frontend sowie Paketdateien verifiziert. Nach einem automatisch ausgelösten Plugin-Neuladen startete der Nutzer den persistent gecachten nativen HDR-Titel Disco Elysium vor dessen regulärem Warmup-Eintrag und bestätigte HDR-Umschaltung sowie Wiederherstellung nach Spielende als erfolgreich. Punkt 2 ist damit abgeschlossen.

## v0.4.21 Development Target

- **Full Non-Steam game support:** Non-Steam games remain explicitly unsupported in v0.4.20. Implement support as one coherent end-to-end goal in v0.4.21 rather than adding only a partial exclusion. First verify the real Steam metadata and START/lifetime event forms. Then cover identification, compatibility lookup, launch decisions, overrides, badges, and restore behavior, including missing or ambiguous metadata. Numeric IDs alone are not proof of a regular Steam game.

## Deferred post-v0.4.20 backlog

- **Require PCGW AppID confirmation:** Every accepted regular-Steam-game match must be confirmed through a Steam-related AppID reference on the PCGamingWiki page; title equality alone must never suffice.
- **Paginate Steam HDR Curator completely:** Fetch and merge all pages with safe termination, duplicate handling, and no partially refreshed persistent cache after a later-page failure.
- **Change source only on information gain:** Preserve stronger PCGamingWiki findings and let Curator data replace them only when it adds compatibility information; never promote Windows Auto HDR to native HDR.
- **Investigate Steam HDR access before replacing it:** Verify the real setter in the current Steam/Decky runtime before removing the fixed module/export lookup; ambiguous discovery must not call an unrelated setter.

### v0.4.19-Regressionsschutz
- Außer den ausdrücklich geplanten Korrekturen bewahren: Detail-/Mini-Badges samt Home-/Library-Schaltern, installierte/nicht installierte Steam-Titel, Override als reine Entscheidungsumkehr und dessen Persistenz, erster START pro Launch-Zyklus sowie einmaliges Restore erst bei App-Ende, nicht bei `GameActionEnd`.
- Cachetreffer, Lazy-Lookups und manuelles Refresh samt Queue-Reset erhalten. Library-Delta verarbeitet nur neue AppIDs, ohne bestehende Einträge erneut abzufragen. Toast-Verhalten am Code charakterisieren: Cache-only ohne Lade-Toasts, Netzwerk-Start/Abschluss, Desktop-Unterdrückung und Wechsel in Game Mode während laufendem Preload. Diese Abläufe vor Änderungen durch Regressionstests absichern; Badge-/Toast-/HDR-Integration ergänzend im Zielsystem prüfen.
