<p align="center">
  <img src="assets/icon.png" width="170" alt="HDR Auto Pilot">
</p>

<h1 align="center">HDR Auto Pilot</h1>

<p align="center">
  <strong>Automatic HDR detection and switching for Steam Game Mode.</strong>
</p>

<p align="center">
  Library status badges ·
  <a href="https://www.pcgamingwiki.com/">PCGamingWiki</a> +
  <a href="https://store.steampowered.com/curator/33286359/">Steam HDR Curator</a> ·
  Automatic HDR switching · State restore · Per-game overrides
</p>

---

## About

**HDR Auto Pilot** is a Decky Loader plugin for Linux-based Steam Game Mode systems that integrates HDR compatibility information and automatic HDR switching directly into the Steam library.

It detects HDR support for Steam games, displays HDR status directly in the library and on game detail pages, automatically configures HDR before launch, and can restore the previous HDR state after the game exits.

For installed games, a per-game **Override** can reverse the automatic launch decision.

---

## Features

- Automatic HDR switching before game launch
- HDR status badges on Steam game detail pages
- Compact HDR status badges directly on Steam library capsules
- HDR information for installed and non-installed Steam games
- Full-library background HDR compatibility preload
- PCGamingWiki as the primary HDR data source
- Steam HDR Curator as an additional compatibility source
- Per-game **Override** for installed titles
- Automatic restoration of the previous HDR state after game exit
- Persistent local compatibility cache
- Manual HDR data refresh
- No live network requests on the launch-critical path
- Controller-friendly Steam Game Mode integration

---

## HDR status

| Status | Meaning | Auto Pilot default |
| --- | --- | --- |
| **HDR** | Native HDR support detected | HDR ON |
| **No HDR** | No native HDR support detected | HDR OFF |
| **Workaround** | HDR is available through a known workaround | HDR OFF |
| **No data** | No reliable HDR information is available | HDR OFF |

Unknown compatibility is handled conservatively as SDR.

### Library mini badges

HDR Auto Pilot displays the detected HDR state directly on Steam library capsules for both installed and non-installed games.

<p align="center">
  <img src="assets/screenshots/Library_MiniBadges.jpg" width="900" alt="HDR Auto Pilot mini badges in the Steam library">
</p>

### Game detail badges

HDR Auto Pilot also displays a larger HDR status badge on Steam game detail pages.

For **installed games**, the badge is shown together with the per-game **Override** control:

<table>
<tr>
<td width="50%"><strong>HDR</strong><br><img src="assets/screenshots/Game_Installed_HDR.jpg" alt="Installed game with HDR"></td>
<td width="50%"><strong>No HDR</strong><br><img src="assets/screenshots/Game_Installed_NoHDR.jpg" alt="Installed game without HDR"></td>
</tr>
<tr>
<td width="50%"><strong>Workaround</strong><br><img src="assets/screenshots/Game_Installed_Workaround.jpg" alt="Installed game with HDR workaround"></td>
<td width="50%"><strong>No data</strong><br><img src="assets/screenshots/Game_Installed_NoData.jpg" alt="Installed game with no HDR data"></td>
</tr>
</table>

For **non-installed games**, the same HDR states are shown without the Override control:

<table>
<tr>
<td width="50%"><strong>HDR</strong><br><img src="assets/screenshots/Game_NotInstalled_HDR.jpg" alt="Non-installed game with HDR"></td>
<td width="50%"><strong>No HDR</strong><br><img src="assets/screenshots/Game_NotInstalled_NoHDR.jpg" alt="Non-installed game without HDR"></td>
</tr>
<tr>
<td width="50%"><strong>Workaround</strong><br><img src="assets/screenshots/Game_NotInstalled_Workaround.jpg" alt="Non-installed game with HDR workaround"></td>
<td width="50%"><strong>No data</strong><br><img src="assets/screenshots/Game_NotInstalled_NoData.jpg" alt="Non-installed game with no HDR data"></td>
</tr>
</table>

The detail badge also shows the source that supplied the compatibility information.

---

## Automatic HDR switching

Game launches use compatibility information that is already available in the local cache.

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

**The launch path never waits for a live network request.**

If no reliable compatibility result is available, HDR Auto Pilot defaults to SDR.

---

## Per-game Override

Installed games expose an **Override** switch next to the HDR badge.

Override reverses HDR Auto Pilot's normal launch decision for that game.

| Auto Pilot would | Override does |
| --- | --- |
| Enable HDR | Launch in SDR |
| Disable HDR | Launch with HDR enabled |

The displayed HDR badge continues to represent the detected compatibility data. Override changes launch behavior only.

<p align="center">
  <img src="assets/screenshots/Game_Installed_Workaround_Override.jpg" width="700" alt="Per-game HDR Override">
</p>

Override is useful for cases such as:

- HDR mods
- RenoDX profiles
- community HDR patches
- injectors
- incomplete compatibility metadata
- manually configured HDR workarounds

For **Workaround** results, HDR remains disabled by default because HDR Auto Pilot cannot know whether the required modification is actually installed.

---

## Data sources and caching

Network lookups are deliberately separated from game launching.

### PCGamingWiki

[PCGamingWiki](https://www.pcgamingwiki.com/) is the primary HDR compatibility source.

HDR Auto Pilot resolves Steam AppIDs to matching PCGamingWiki pages and normalizes the available HDR information into the plugin's user-facing states.

If PCGamingWiki's direct AppID redirect fails, HDR Auto Pilot can fall back to Steam game metadata and PCGamingWiki's MediaWiki search API.

Fallback title matches are validated against the exact Steam AppID before being accepted.

### Steam HDR Curator

[Steam HDR Curator](https://store.steampowered.com/curator/33286359/) is used as an additional source when PCGamingWiki reports:

- No HDR
- No data
- Workaround

Curator information can promote a result to native HDR support or a known HDR workaround.

A result already identified as native HDR by PCGamingWiki is never downgraded.

**Windows Auto HDR entries are intentionally not treated as native HDR support.**

### Local cache and library preload

Compatibility results are stored locally to avoid unnecessary repeated requests.

HDR Auto Pilot preloads HDR compatibility information for the Steam game library in the background so library badges and launch decisions can use cached data immediately.

Steam Game Mode shows a short notification when HDR data has to be loaded from the network.

After the initial library snapshot, newly added Steam games are detected automatically. Only previously unknown AppIDs are added to the preload queue; existing library entries are not scanned again.

Steam HDR Curator information is stored in a separate persistent cache and refreshed periodically.

### Manual refresh

HDR compatibility data can be refreshed manually through the plugin settings.

---

## Plugin settings

HDR Auto Pilot currently provides settings for:

- enabling or disabling automatic HDR switching
- restoring the previous HDR state after game exit
- enabling or disabling library mini badges
- showing mini badges independently on the Game Mode Home screen and in the Library
- refreshing cached HDR compatibility data

The larger game-detail HDR badge and the per-game **Override** control are core plugin features and remain available independently of the mini-badge settings.

Per-game Override selections and plugin settings are stored persistently.

<p align="center">
  <img src="assets/screenshots/Plugin_Settings_0418.jpg" width="700" alt="HDR Auto Pilot settings">
</p>

---

## Requirements

- Linux-based Steam Game Mode system
- Steam
- Decky Loader
- Gamescope
- `gamescopectl` with `hdr_enabled` support
- HDR-capable display
- Working HDR output in the host system

HDR Auto Pilot controls the HDR state exposed by the Steam / Gamescope environment.

It does **not** convert SDR games into HDR.

### Non-Steam games

Version **0.4.19 supports regular Steam games with a valid Steam AppID only**.

Games added to Steam as **Non-Steam games** are not currently supported. HDR compatibility lookup, PCGamingWiki links, library mini badges, and automatic HDR switching may therefore be unavailable or incomplete for these entries.

Full Non-Steam game support is planned for the next release.

### Platform compatibility

| Platform | Gamescope / Game Mode | HDR Auto Pilot status |
| --- | --- | --- |
| **Bazzite** | Yes | **Verified** |
| **SteamOS** | Yes | **Supported target platform** |
| **CachyOS Game Mode** | Available | Expected to work, not yet tested |
| **ChimeraOS** | Yes | Expected to work, not yet tested |
| **Nobara Steam/Game Mode** | Available | Expected to work, not yet tested |

Compatibility requires a working Decky Loader environment and a `gamescopectl` implementation that supports reading and changing `hdr_enabled`.

The plugin contains no Bazzite-specific user paths, fixed user IDs, or fixed Gamescope session names. Runtime Gamescope sessions are detected dynamically.

Windows and macOS are not supported.

---

## Installation

HDR Auto Pilot is distributed independently through this GitHub repository.

The plugin can be installed manually in Decky Loader using a release package.

Normal installation is handled entirely through Decky Loader. No root access or manual `sudo` commands are required.

HDR Auto Pilot is currently **not distributed through the official Decky Plugin Store**.

### Development build

<pre>
pnpm install
pnpm run build
</pre>

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
│   ├── icon.png
│   └── screenshots/
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
- mini badges
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
- The user can reverse the automated decision for an installed game.

---

## Credits

HDR compatibility information is provided by:

- [PCGamingWiki](https://www.pcgamingwiki.com/)
- [Steam HDR Curator](https://store.steampowered.com/curator/33286359/)

Built for [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) using the official Decky plugin template.

---

## License

See [LICENSE](LICENSE).
