# GhostBar backup — 30 October 2026

Backup of the GhostBar projects, source versions, documents, assets, and development scripts recovered from this Mac before disk cleanup.

- `desktop-project/`: original GhostBarFinal and GhostBarWebhook projects, admin pages, and guides.
- `current-project/`: current project source, handover notes, and development scripts.
- `temporary/`: source and scripts from earlier build sessions.
- `downloads/`: downloaded source, UI archive, and guide.
- `BACKUP-MANIFEST.json`: original locations and SHA-256 checksums for every backed-up file.

The current public source is at https://github.com/nakhundov02/GhostBar. Current app downloads are under https://github.com/nakhundov02/GhostBar/releases.

Older installers are being preserved as assets in this repository's `mac-cleanup-2026-10-30` release. Its installer manifest records assets already verified in the public repository.

Generated dependencies, duplicated unpacked apps, caches, temporary browser profiles, and test certificates are excluded. They can be rebuilt from the source and lockfiles or restored from the installer archives. Account credentials, private keys, certificates, and live application settings are not published. Empty source scaffold directories are listed in the exclusion inventory.

To recover a project, clone this repository and use its corresponding project directory. Follow that project's README or build instructions; the current Electron project uses `npm ci` and `npm run setup:proxy` before building.
