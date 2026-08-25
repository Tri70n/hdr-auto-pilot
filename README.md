<p align="center">
  <img src="assets/icon.png" width="150" alt="HDR Auto Pilot logo">
</p>

<h1 align="center">HDR Auto Pilot</h1>

<p align="center">
  Automatic HDR detection, library status badges, launch-time HDR switching, state restore, and per-game overrides for Steam Game Mode.
</p>

<p align="center">
  <strong>Decky Loader plugin · PCGamingWiki + Steam HDR Curator</strong>
</p>

## Overview

HDR Auto Pilot brings HDR awareness directly into the Steam library.

It detects a game's HDR capabilities, shows the result on the game detail page, and automatically sets Steam's global HDR state before launch. When the game closes, the previous HDR state can be restored automatically.

For installed games, a per-game **Override** switch can reverse Auto Pilot's decision whenever metadata does not match the desired behavior.

## Features

- Automatic HDR switching before game launch
- HDR status badge on Steam library detail pages
- HDR information for installed and non-installed library titles
- PCGamingWiki as the primary HDR data source
- Steam HDR Curator fallback for native HDR and known workarounds
- Per-game **Override** for installed titles
- Automatic restoration of the previous HDR state after exit
- Persistent local cache with background warm-up for installed games
- No network requests on the launch-critical path
- Controller-friendly navigation in Steam Game Mode

## Status badges

| Badge | Meaning | Auto Pilot default |
| --- | --- | --- |
| **HDR** | Native HDR support detected | HDR on |
| **No HDR** | No native HDR support detected | HDR off |
| **Workaround** | HDR is available through a known workaround | HDR off |
| **No data** | No reliable HDR information is available | HDR off |

The badge also shows which data source supplied the result.

## Auto Pilot behavior

When HDR Auto Pilot is enabled, the cached HDR result determines the launch-time HDR state:

- **HDR** → HDR enabled
- **No HDR** → HDR disabled
- **Workaround** → HDR disabled
- **No data** → HDR disabled

The decision is made from local cache data. Game launch never waits for a live network lookup.

If **Restore previous HDR state** is enabled, HDR Auto Pilot restores the global HDR state that was active before the game started.

## Override

Installed games expose an **Override** switch next to the HDR badge.

Override reverses Auto Pilot's normal decision for that specific game:

- Auto Pilot would enable HDR → Override launches in SDR
- Auto Pilot would disable HDR → Override launches with HDR enabled

The displayed badge continues to show the detected data status. Override changes launch behavior only.

## Data sources

### PCGamingWiki

PCGamingWiki is the primary source for HDR capability information.

### Steam HDR Curator

When PCGamingWiki reports **No HDR**, **No data**, or a workaround, HDR Auto Pilot can consult Steam HDR Curator data as an additional source.

Curator entries can promote a result to:

- native HDR support
- known HDR workaround

Windows Auto HDR entries are intentionally **not** treated as native HDR support.

## Cache

HDR Auto Pilot maintains local caches to keep library browsing responsive and launches deterministic.

- PCGamingWiki results are cached locally
- Steam HDR Curator data uses a separate periodically refreshed cache
- Installed games are warmed in the background
- Library titles can be resolved lazily when their detail page is opened
- Installed-game HDR data can be refreshed manually from plugin settings

## Requirements

- Steam
- Decky Loader
- Steam Game Mode / Gamescope environment with HDR support
- HDR-capable display and correctly configured system HDR output

## Installation

HDR Auto Pilot is currently installed through Decky Loader using the plugin ZIP package.

A Decky Plugin Store release is planned.

## Controller navigation

For installed games:

- **Right** from HDR badge → Override
- **Left** from Override → HDR badge
- **Down** from Override → Steam settings button
- **Up** from Steam settings button → Override

External PCGamingWiki pages opened from the badge should be closed with controller **B**.

## Screenshots

Final screenshots will be added before release.

## Privacy

HDR Auto Pilot does not require an account and does not collect personal data.

Network access is used only to retrieve HDR compatibility information.

## Credits

HDR compatibility data is provided by:

- PCGamingWiki
- Steam HDR Curator

Built for Decky Loader using the official Decky plugin template.

## License

See [LICENSE](LICENSE).
