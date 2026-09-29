# GSICM

A local satellite acquisition and Sanchez composition manager for Windows. React dashboard, TypeScript/Node backend, SQLite persistence, and the bundled `bin/Sanchez.exe`.

## Start

Install **Node.js 24 or newer**, then double-click `Start-GSICM.cmd`. The launcher installs locked dependencies if needed, builds the dashboard, starts a hidden local server, and opens **http://127.0.0.1:3210**. Processing continues after the browser closes. It is not installed as a Windows startup service.

For a visible server with diagnostic logs:

```powershell
npm ci
npm run build
npm start
```

Press Ctrl+C to stop a foreground server. For a launcher-started server, use `Stop-GSICM.ps1`.

For frontend development, run `npm start` and `npx vite` in separate terminals. Vite proxies `/api` to the local backend. `npm run build` checks TypeScript and generates `dist/`.

## Login

Login is optional for the local dashboard. To enable it for launcher starts, run:

```powershell
.\Set-GSICM-Password.ps1
.\Stop-GSICM.ps1
.\Start-GSICM.ps1
```

The launcher stores the password in a local, git-ignored `.gsicm-password` file and passes it to the server as `GSICM_PASSWORD`. To disable login again, run:

```powershell
.\Set-GSICM-Password.ps1 -Clear
.\Stop-GSICM.ps1
```

For foreground or service-style starts, set `GSICM_PASSWORD` in the process environment before running `npm start`.

## First run

The five regional source entries are **disabled placeholders**. Public sample feeds inspected so far contain annotations or enhanced colours and are unsuitable for the chosen clean-imagery policy. See [feed verification notes](docs/FEEDS.md). No live global composite is claimed or fabricated.

Configure sources, test and inspect previews, confirm clean full-disc geometry, then enable and retest. Edit the map/globe profiles to select required sources and enable scheduling. “Run now” follows the same strict source requirements as scheduled runs.

HTTP templates support `{YYYY}`, `{MM}`, `{DD}`, `{DDD}`, `{HH}`, `{mm}`, `{ss}` in UTC. FTP/FTPS lists directories and S3 lists bucket prefixes; both support date templates. FTPS uses explicit TLS on port 21 unless a port is specified. Only anonymous access is supported. Regex capture group 1 must hold an observation timestamp in compact UTC, ISO UTC, or year/day-of-year format. A `latest.jpg` filename alone is insufficient.

Source tests validate decoding, dimensions, and timestamp compatibility. Visual cleanliness and satellite geometry require operator confirmation; software cannot infer them from dimensions alone. Missing or out-of-tolerance inputs fail the job without publishing a partial composite. Output details list the actual included observations and attribution.

## Defaults and files

- Poll every 10 minutes; target the previous completed interval boundary; accept observations within ±30 minutes.
- Map and globe at 4 km, JPEG, globe centred at 180°; bundled underlay, configurable colour controls.
- One compositor at a time. Downloads use temporary files, bounded retries, size limits, and timeouts. Queued/running jobs become interrupted after a restart.
- Keep only the latest successful output per profile, a two-hour acquisition cache, and seven days of job history/logs. Cache cleanup waits while processing or source testing is active. File cleanup is confined to manager-owned directories.
- State lives in `data/manager.sqlite`; cache, work files, and outputs live beneath `data/`. Preserve this directory to keep configuration. `GSICM_DATA_DIR` overrides it for isolated instances/tests. `PORT` overrides port 3210.
- The web server listens on loopback only. Optional password login is for local dashboard access, not remote/public deployment.

## API

`GET /api/state` returns configuration, blockers, job summaries, and output metadata. `PUT /api/sources/:id`, `PUT /api/profiles/:id`, and `PUT /api/settings` validate JSON configuration. `POST /api/sources/:id/test` retrieves and checks a sample. `POST /api/profiles/:id/run` queues work; `POST /api/jobs/:id/cancel` cancels it. `GET /api/jobs/:id` includes logs; `/api/images/:id` and `/api/outputs/:profileId` serve preview/output files. Configuration edits are locked while tests or jobs are active.

## Validation

```powershell
npm test
npm run smoke
npm run test:ui
```

Unit/integration tests cover HTTP, FTP, certificate-verified FTPS, anonymous paginated S3, timestamps, invalid images, retries, cancellation, recovery, cleanup, and API validation. Smoke tests run the actual bundled Sanchez for both projections against explicitly synthetic full-disc fixtures in temporary storage. Browser tests use an isolated database and synthetic imagery; install Chromium with `npx playwright install chromium` if needed.

Raw scientific decoding is supported for the verified public GOES-18/19, GK-2A, and Himawari-9 products. Meteosat Europe/Africa and Indian Ocean coverage remain setup blockers because no clean, account-free, timestamped feed has been verified. Provider credentials, live feed guarantees, polar cloud observations, historical archives, and OS startup integration remain outside this release.
