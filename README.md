<p align="center">
  <img src="assets/icon.png" width="160" alt="HDR Auto Pilot">
</p>

<h1 align="center">HDR Auto Pilot</h1>

<p align="center">
  Automatic HDR detection and switching for Steam games in Decky Loader.
</p>

## What it does

HDR Auto Pilot takes care of HDR when launching Steam games from Game Mode.

It detects a game's HDR capabilities, displays the result directly on the Steam library detail page, and automatically switches the global HDR state before launch.

When the game closes, HDR Auto Pilot can restore the HDR state that was active beforehand.

## Features

- Automatic HDR switching when launching Steam games
- HDR status directly on Steam library game pages
- Works with installed and non-installed library titles for HDR information
- PCGamingWiki as the primary HDR data source
- Steam HDR Curator as an additional source for native HDR and known workarounds
- Persistent local cache to avoid unnecessary network requests
- Background cache warm-up for installed games
- Restores the previous HDR state after the game closes
- Per-game **Override** for installed games
- Full controller navigation in Steam Game Mode

## HDR status

HDR Auto Pilot displays one of four states:

| Status | Meaning |
| --- | --- |
| **HDR** | Native HDR support detected |
| **No HDR** | No native HDR support detected |
| **Workaround** | HDR is available through a known workaround |
| **No data** | No reliable HDR information is currently available |

The badge also shows which source supplied the result.

## Automatic switching

When HDR Auto Pilot is enabled:

- **HDR** games launch with HDR enabled.
- **No HDR**, **No data**, and **Workaround** entries normally launch with HDR disabled.
- The previous global HDR state can automatically be restored when the game exits.

HDR decisions are cached before launch. The launch path itself does not perform network requests.

## Override

Installed games provide an additional Override switch next to the HDR badge.

Override reverses HDR Auto Pilot's normal decision for that game:

- If Auto Pilot would enable HDR, Override launches the game in SDR.
- If Auto Pilot would disable HDR, Override launches the game with HDR enabled.

This makes it possible to handle games, mods and HDR workarounds that cannot be represented perfectly by metadata alone.

## Data sources

### PCGamingWiki

PCGamingWiki is the primary source for HDR capability information.

### Steam HDR Curator

HDR Auto Pilot also checks the Steam HDR Curator when PCGamingWiki reports no HDR support, no data, or a workaround.

Curator entries can upgrade a result to:

- native HDR support
- known HDR workaround

Windows Auto HDR entries are intentionally not treated as native HDR support.

## Cache

HDR Auto Pilot maintains a local HDR database to keep library browsing responsive and ensure that game launch decisions never depend on a live network request.

PCGamingWiki results are cached locally.

Steam HDR Curator data uses a separate cache and is refreshed periodically.

The plugin settings include a manual refresh option for installed-game HDR data.

## Requirements

- Steam
- Decky Loader
- A Gamescope/Steam Game Mode environment with HDR support

HDR must be supported by the display and system configuration.

## Installation

HDR Auto Pilot is currently installed through Decky Loader using the plugin ZIP package.

A Decky Plugin Store release is planned.

## Controller navigation

The HDR badge integrates into Steam's controller navigation.

For installed games, press **Right** from the HDR badge to reach the Override switch and **Left** to return.

External PCGamingWiki pages opened from the badge should be closed with the controller **B** button.

## Privacy

HDR Auto Pilot does not require an account and does not collect personal data.

Network access is used only to retrieve HDR compatibility information from its data sources.

## Credits

HDR compatibility data is provided by:

- PCGamingWiki
- Steam HDR Curator

Built for Decky Loader using the official Decky plugin template.

## License

See [LICENSE](LICENSE).
