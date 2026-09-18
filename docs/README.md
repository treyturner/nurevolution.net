# Documentation

Start with [current status and follow-ups](STATUS.md). The [roadmap](../ROADMAP.md) defines milestone scope; dated plans and evidence describe what was known and tested at the time.

| Guide                                                                                               | Purpose                                                                                             |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Development](DEVELOPMENT.md)                                                                       | Runtime setup, local/remote preview, commands, tests, architecture, CI, and dependency maintenance. |
| [Content](CONTENT.md)                                                                               | Archive inventory, episode authoring, precise timestamps, artwork, and identity preservation.       |
| [Player](PLAYER.md)                                                                                 | Current listening, navigation, restoration, controls, and media behavior.                           |
| [Feed validation](FEED-VALIDATION.md)                                                               | RSS verification and observed podcast-client behavior.                                              |
| [Deployment](DEPLOYMENT.md)                                                                         | Verified release publication, manual production promotion, and host contracts.                      |
| [Monitoring and maintenance](operations/incidents.md)                                               | Uptime checks, incident handling, and recurring operational reviews.                                |
| [Backup and restore](operations/backup-restore.md)                                                  | Application/media backups to MinIO and recovery procedures.                                         |
| [Headscale](operations/headscale.md) and [its backups](operations/headscale-backup.md)              | Private deployment access and independent Google Drive recovery.                                    |
| [Node runtime](operations/node-runtime.md) and [tooling bootstrap](operations/tooling-bootstrap.md) | Completed mise/Node 24 migration, reproducible host setup, and verified helper selection.           |
| [Virtual playback](operations/virtual-playback.md)                                                  | Lossless VBR remuxing, audit, generation, and fallback rules.                                       |
| [Rollback](operations/rollback.md), [TLS](operations/tls.md), and [media](operations/media.md)      | Operational recovery and serving contracts.                                                         |

## Next milestone

[M8 listening and feed enhancements](milestones/M08-listening-and-feed-enhancements.md) records the agreed five-area scope and exclusions. Drafts/scheduling moves to M9; older milestone plans retain their original numbers.

## Acceptance and history

- [M6 closure](milestones/M06-cutover-and-retirement.md), [retirement evidence](milestones/evidence/M06-retirement.json), and [Unraid reboot checks](milestones/evidence/M06-unraid-reboot.json).
- [September 18 owner acceptance](operations/acceptance-2026-09-18.md), including Podcast Addict coverage and the Safari 14.3 finding.
- [M7 implementation and review history](milestones/M07-rich-player-and-restoration.md).
- [Milestone plans](milestones/), [migration audit](migration/MIGRATION-AUDIT.md), [original bootstrap brief](BOOTSTRAP.md), and [dated maintenance history](operations/maintenance.md).

Current guides supersede dated proposals. Preserve historical versions, counts, and test limitations in evidence records rather than rewriting earlier results as current measurements.
