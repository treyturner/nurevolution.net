# Current status and follow-ups

Reconciled on **2026-09-18**. Production is [nurevolution.net](https://nurevolution.net/); development uses authenticated local/workspace previews. Production is the only hosted deployment environment.

## Delivered

- M0-M4 delivered the audited archive, Nuxt application, compatible RSS, and original player.
- M5 delivered verified release artifacts, manual promotion, rollback, monitoring, backups, and component recovery rehearsals.
- **M6 is closed.** The owner confirmed retirement of the old site/database and their backups, accepted the observation outcome and a four-hour recovery objective, and approved the recorded limitations. Headscale/firewall restart, backup tools, and weekly scheduling passed the Unraid reboot check. See [closure evidence](milestones/evidence/M06-retirement.json).
- M7 and subsequent UI refinements are released: custom controls, timed tracks, list-relative sequencing, paused restoration, current-track status, error feedback, and duration/timestamp display. [Player behavior](PLAYER.md) is the current reference.
- Lossless virtual MP4 delivery improves Chromium VBR seeking without duplicating or re-encoding the stored audio. Other browser paths retain the original MP3; RSS enclosures and downloads remain unchanged. [Delivery details](operations/virtual-playback.md).
- Node 24 is used by the application, CI, and mise-managed deployment/backup tooling. The host migration and post-deployment backup completed on September 17. [Runtime runbook](operations/node-runtime.md).
- CodeQL and grouped Dependabot version updates are configured. The owner confirmed security alerts enabled. Automatic security-update PR enablement has not been independently verified; see [maintenance guidance](DEVELOPMENT.md#dependency-choices-and-ci).

## Archive completeness

The catalog contains **55 episodes and 832 listed tracks**:

| Coverage                        | Episodes | Tracks |
| ------------------------------- | -------: | -----: |
| Complete timestamped tracklists |       34 |    626 |
| Tracklists without timestamps   |       16 |    206 |
| No tracklist                    |        5 |      0 |

There are no partially timestamped tracklists. The sixteen untimed lists are guest-artist episodes. Among Trey Turner/Fracture episodes, the only missing tracklists/timings are the two **Live on Mega 93.3FM** parts. The other missing lists are EazyTom's **Live from The Pink Cybernetic Cabaret** and **Dub Noctem**, and DRRTYWULVZ's **Live at Carpe Noctem 2011**. Preserve missing information rather than inventing track names or cut points. [Content guide](CONTENT.md).

## Planned work and loose ends

1. **M8: listening and feed enhancements.** All five areas are implemented across local review slices. Safari PR #56, including the preview download range fix, passed automatic review and all CI checks; the owner confirmed iPad playback, seeking, both reported visual fixes, and downloading. The owner also confirmed Download MP3 -> View works; dialog/restoration/guest-episode checks remain pending. Current-position copying now uses a context menu opened from the playhead thumb in the preview; both timestamp-copy controls retain the current browser origin so preview links reopen the preview. Timestamp sharing, Media Session, feed-resource support, and RSS advertisement are on local forward branches awaiting their review slots and physical/UI/client acceptance. **RSS chapters are not yet deployed.** No M8 deployment is authorized. [Implementation plan and acceptance](milestones/M08-listening-and-feed-enhancements.md).
2. **M9: drafts and scheduled repository publishing.** Complete authoring, coordinated visibility/cache timing, asset readiness, and a rollback strategy that preserves newly published episodes. Existing filtering is only part of that workflow. [Roadmap](../ROADMAP.md#m9---drafts-and-scheduled-repository-publishing).
3. **Deferred enhancements:** palettes and track/artist/release links are explicitly deferred. Unlisted previews remain separately scoped after M9; Spaces evaluation belongs to operational cost/capacity review. No later milestone is committed for these items.
4. **Content:** identify the two MEGA tracklists and any available guest lists/timestamps. Missing data is not a playback, M6, or M8 blocker; chapters will use available timings.
5. **Operations:** measure replacement-host recovery against the accepted four-hour objective, review storage/transfer/cost growth, and continue scheduled backups/monitoring. An accepted recovery target is not a measured guarantee. [Maintenance cadence](operations/incidents.md#maintenance-cadence).
6. **Manual observations:** current Safari on physical hardware, complete podcast-client downloads, pre-migration subscription refresh, and directory checks remain unverified. Assistive checks are owner-deferred enhancements. Podcast Addict loading/seeking passed for all 55 episodes. The [Safari 14.3 finding](operations/acceptance-2026-09-18.md#ipad-safari-observation) has an owner-tested preview fix; remaining M8 acceptance does not reopen M6.
7. **Optional product decision:** browsing another episode while the current one keeps playing would need independent browsing/playback state; the current confirmation dialog does not implement this, and it is outside M8/M9.

The owner swapped unstarted M8/M9 on September 18. M0-M7 keep their IDs; older milestone plans use their original numbering.

## Release status

A passing main Verify run publishes verified artifacts. **Production deployment is a separate manual workflow.** Use the [deployment history](https://github.com/treyturner/nurevolution.net/actions/workflows/deploy.yml) and `/api/health` for the serving revision; the main Verify badge does not imply that revision has been deployed. [Production runbook](DEPLOYMENT.md).

Dated milestone documents retain historical snapshots. This page and the current behavior/operations guides identify what remains actionable; an old pending item is not automatically a current blocker.
