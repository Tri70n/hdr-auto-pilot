<p align="center">
  <img src="assets/icon.png" width="170" alt="HDR Auto Pilot">
</p>

<h1 align="center">HDR Auto Pilot</h1>

<p align="center">
  <strong>Automatic HDR detection and switching for Steam Game Mode.</strong>
</p>

<p align="center">
  Library status badges · PCGamingWiki + Steam HDR Curator · Automatic HDR switching · State restore · Per-game overrides
</p>

---

## About

**HDR Auto Pilot** is a Decky Loader plugin that integrates HDR information and automatic HDR switching directly into the Steam Game Mode library.

It detects a game's HDR capabilities, displays the result on the Steam detail page, and automatically configures the global HDR state before launch.

When the game closes, HDR Auto Pilot can restore the HDR state that was active beforehand.

For installed games, an **Override** switch allows the automatic decision to be reversed per game.

---

## Features

- Automatic HDR switching before game launch
- HDR status badges directly on Steam library detail pages
- HDR information for installed and non-installed library titles
- PCGamingWiki as the primary HDR data source
- [Steam HDR Curator](https://store.steampowered.com/curator/33286359/) as an additional source for native HDR and known workarounds
- Per-game **Override** for installed titles
- Automatic restoration of the previous HDR state after game exit
- Persistent local compatibility cache
- Background cache warm-up for installed games
- Lazy lookup for uncached library titles
- Manual HDR data refresh
- No network requests on the launch-critical path
- Controller-friendly navigation in Steam Game Mode

---

## HDR status

| Status | Meaning | Auto Pilot default |
| --- | --- | --- |
| **HDR** | Native HDR support detected | HDR ON |
| **No HDR** | No native HDR support detected | HDR OFF |
| **Workaround** | HDR is available through a known workaround | HDR OFF |
| **No data** | No reliable HDR information is currently available | HDR OFF |

The badge also displays the source that supplied the compatibility information.

---

## Automatic switching

HDR Auto Pilot uses already cached compatibility information when a game starts.

<pre>
Steam game launch
        ↓
Read cached HDR result
        ↓
Apply per-game Override
        ↓
Remember previous HDR state
        ↓
Set global HDR state
        ↓
Launch game
        ↓
Game exits
        ↓
Restore previous HDR state
</pre>

A missing cache entry is treated conservatively as SDR.

**The launch path never waits for a live network request.**

---

## Override

Installed games expose an **Override** switch next to the HDR badge.

Override reverses HDR Auto Pilot's normal decision for that specific game.

| Auto Pilot would | Override does |
| --- | --- |
| Enable HDR | Launch in SDR |
| Disable HDR | Launch with HDR enabled |

The displayed HDR badge continues to represent the detected compatibility data. Override changes the launch behavior only.

This is particularly useful for:

- HDR mods
- RenoDX profiles
- manually installed HDR workarounds
- incomplete compatibility metadata
- games where the automatic decision needs to be reversed manually

---

## Restore previous HDR state

HDR Auto Pilot can remember the global HDR state that was active before a game started.

<pre>
Steam HDR state: OFF
        ↓
Launch HDR game
        ↓
HDR Auto Pilot: HDR ON
        ↓
Game exits
        ↓
HDR Auto Pilot restores: HDR OFF
</pre>

This allows HDR to be enabled only while it is actually required.

---

## Data sources

### PCGamingWiki

[PCGamingWiki](https://www.pcgamingwiki.com/) is the primary HDR compatibility source.

HDR Auto Pilot resolves Steam AppIDs to their corresponding PCGamingWiki entries and normalizes the available HDR information into the plugin's user-facing states.

### Steam HDR Curator

[Steam HDR Curator](https://store.steampowered.com/curator/33286359/) is used as an additional source when PCGamingWiki reports:

- No HDR
- No data
- Workaround

Curator information can promote a result to:

- native HDR support
- known HDR workaround

A result already identified as native HDR by PCGamingWiki is never downgraded.

**Windows Auto HDR entries are intentionally not treated as native HDR support.**

HDR Auto Pilot does not claim that SDR-to-HDR conversion is equivalent to native HDR.

---

## Smart caching

Web lookups are deliberately separated from game launching.

### PCGamingWiki cache

PCGamingWiki compatibility results are stored locally to avoid unnecessary repeated requests.

### Steam HDR Curator cache

[Steam HDR Curator](https://store.steampowered.com/curator/33286359/) data is stored in a separate persistent cache and refreshed periodically.

### Installed-game warm-up

Installed games are resolved in the background so their HDR information is already available before launch.

### Lazy library lookup

HDR Auto Pilot also supports games that are in the Steam library but not currently installed.

Opening an uncached game's detail page triggers a lookup automatically. Once resolved, the result becomes part of the local cache.

### Manual refresh

Installed-game HDR compatibility data can be refreshed manually through the plugin settings.

---

## Workaround handling

A **Workaround** result means that HDR is known to be available through an external modification or special configuration.

Examples can include:

- RenoDX
- community HDR patches
- injectors
- game-specific modifications

HDR Auto Pilot deliberately keeps HDR disabled by default for these entries because it cannot know whether the required workaround is actually installed.

If the workaround is present, enable **Override** for that game to launch it with HDR.

---

## No data handling

When no reliable HDR information is available, HDR Auto Pilot defaults to SDR.

This conservative behavior prevents unknown games from unexpectedly enabling HDR.

Override remains available for installed titles, so the user can still force the opposite launch behavior.

---

## Controller navigation

The library integration is designed for Steam Game Mode and controller use.

For installed games:

- **Right** from HDR badge → Override
- **Left** from Override → HDR badge
- **Down** from Override → Steam settings button
- **Up** from Steam settings button → Override

The HDR badge also integrates into the surrounding Steam navigation flow.

External compatibility pages opened from the badge should be closed using controller **B**.

---

## Requirements

- Steam
- Decky Loader
- Steam Game Mode / Gamescope
- HDR-capable display
- Working HDR output in the host system

HDR Auto Pilot controls the HDR state exposed by the Steam / Gamescope environment.

It does **not** convert SDR games into HDR.

---

## Installation

HDR Auto Pilot is currently distributed as a Decky plugin ZIP package.

Official Decky Plugin Store distribution is planned.

### Development build

<pre>
pnpm install
pnpm run build
</pre>

---

## Plugin settings

HDR Auto Pilot currently provides settings for:

- enabling or disabling automatic HDR switching
- restoring the previous HDR state after game exit
- refreshing cached HDR data for installed games

Per-game Override selections are stored persistently.

---

## Screenshots

Final screenshots for the first public release are currently being prepared.

Planned examples include:

- Native HDR game
- No HDR game
- Workaround detected through Steam HDR Curator
- Per-game Override
- Plugin settings
- Cache and refresh view

---

## Privacy

HDR Auto Pilot:

- requires no account
- collects no personal information
- contains no analytics
- contains no telemetry

Network access is used only to retrieve HDR compatibility metadata.

---

## Project structure

<pre>
hdr-auto-pilot/
├── assets/
│   └── icon.png
├── src/
│   └── index.tsx
├── main.py
├── pcgw_helper.py
├── plugin.json
├── package.json
└── README.md
</pre>

### Frontend

The TypeScript/React frontend handles:

- Steam library badge integration
- Override control
- plugin settings
- controller navigation
- game launch detection
- HDR switching
- previous-state restoration

### Backend

The Python backend handles:

- persistent settings
- PCGamingWiki resolution
- compatibility caching
- Steam HDR Curator caching
- source fallback logic

### PCGamingWiki helper

`pcgw_helper.py` performs isolated PCGamingWiki resolution in a sanitized Python environment.

---

## Design principles

HDR Auto Pilot follows a few deliberate rules:

- Game launches must never depend on a live network request.
- Native HDR and SDR-to-HDR conversion are not treated as the same thing.
- Compatibility metadata and user overrides remain separate.
- Unknown compatibility defaults conservatively to SDR.
- The user can always reverse the automated decision for an installed game.

---

## Credits

HDR compatibility information is provided by:

- [PCGamingWiki](https://www.pcgamingwiki.com/)
- [Steam HDR Curator](https://store.steampowered.com/curator/33286359/)

Built for [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) using the official Decky plugin template.

---

## License

See [LICENSE](LICENSE).
