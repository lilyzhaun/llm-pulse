# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses semantic versioning.

## [Unreleased]

### Changed

- Updated project documentation for the upstream PostgreSQL architecture: the BFF now reads the `new-api` `logs` table through `DATABASE_URL`, keeps only a lightweight in-memory snapshot, and documents degraded fallback behavior when PostgreSQL is unavailable.
- Documented additive API fields for `dataSource` and model-level `tokens`, `cost`, `rpm`, and `tpm`.

### Removed

- Removed stale documentation for the previous collection and local state workflow.

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

- Ignored runtime state artifacts.
- Removed tracked runtime state artifacts from the repository.
