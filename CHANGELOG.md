# Changelog

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
