# Changelog

## 0.4.15 - 2026-08-25

### Fixed

- Restored lazy HDR lookups for uncached and non-installed Steam library titles.
- Prevented duplicate HDR badge component injection during Steam library re-renders.
- Preserve completed lazy lookup results even if the user leaves the game page before the request finishes.
- Added a resilient PCGamingWiki fallback using the Steam game name and MediaWiki search when `appid.php` returns HTTP errors such as 404 or 500.
- Fixed missing HDR badges for affected titles including DOOM Eternal and Half-Life 2.
