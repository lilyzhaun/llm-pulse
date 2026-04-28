# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses semantic versioning.

## [0.1.0]

### Added

- Added the LLM Pulse dashboard for monitoring aggregated model availability.
- Added theme toggle support.
- Added error status-code mapping for clearer status handling.

### Changed

- Updated the theme palette.
- Updated status badge styling to use neutral presentation where appropriate.
- Restored semantic status colors and synced the browser `theme-color` metadata.

### Fixed

- Removed the green highlight from the toolbar refresh state.

### Chore

- Ignored runtime SQLite state files.
- Removed tracked SQLite runtime state from the repository.
