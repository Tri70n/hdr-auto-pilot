# Changelog

## 0.4.19 - 2026-08-29

### Changed

- Improved portability across Linux-based Steam Game Mode systems.
- Removed Fedora/Bazzite-specific certificate paths from the PCGamingWiki helper runtime.
- System Python 3 is now detected dynamically instead of using a fixed executable path.
- Updated package metadata for public distribution.
- Removed the development-only plugin debug flag.
- Updated the license copyright information.
- Expanded public documentation with platform requirements and compatibility status.
- Updated installation documentation for independent GitHub distribution.
- Automatic HDR switching is now enabled by default on fresh installations.
- Fixed preload notifications when HDR data loading starts outside Game Mode and continues after switching into Game Mode.
- Documented that Non-Steam games are not supported in version 0.4.19.

## 0.4.18 - 2026-08-29

### Added

- Added settings to enable or disable library mini badges.
- Added independent mini badge visibility controls for the Game Mode Home screen and Library.
- Added automatic detection of newly added Steam library games after the initial library snapshot.
- Added incremental HDR data preloading for newly added Steam AppIDs.

### Changed

- Mini badge settings now update visible badges immediately without affecting game-detail HDR badges or per-game Override controls.
- Newly added library games are processed incrementally without rescanning or refetching existing library entries.
- HDR loading notifications for incremental updates now reflect only the number of newly fetched games.
- Game Mode Home and Library mini badge visibility now use their actual Steam UI routes.

### Fixed

- Fixed Home and Library mini badge settings affecting the wrong Steam Game Mode views.
- Removed obsolete detail-badge settings plumbing so game-detail badges remain a permanent core feature.

## 0.4.17 - 2026-08-26

### Added

- Added compact HDR status badges to Steam library capsules for installed and non-installed games.
- Added mini badge states for HDR, No HDR, Workaround, and No Data.
- Added full-library HDR data preloading for Steam library games.
- Added Game Mode notifications when HDR data loading starts and finishes.

### Changed

- Mini badges now reuse cached PCGamingWiki HDR results across the Steam library.
- Mini badge rendering now handles Steam library re-renders and recycled capsule artwork.
- HDR loading notifications are suppressed in Steam Desktop mode.
- Loading progress notifications were simplified to one start notification and one completion notification.

## 0.4.16 - 2026-08-25

### Fixed

- Improved PCGamingWiki fallback resolution for Steam titles whose Steam and PCGamingWiki names differ.
- Added progressive title fallback with exact Steam AppID validation.
- Fixed HDR detection for Borderlands and Borderlands Game of the Year Enhanced.

## 0.4.15 - 2026-08-25

### Fixed

- Restored lazy HDR lookups for uncached and non-installed Steam library titles.
- Prevented duplicate HDR badge component injection during Steam library re-renders.
- Preserve completed lazy lookup results even if the user leaves the game page before the request finishes.
- Added a resilient PCGamingWiki fallback using the Steam game name and MediaWiki search when `appid.php` returns HTTP errors such as 404 or 500.
- Fixed missing HDR badges for affected titles including DOOM Eternal and Half-Life 2.
