# ESPN hidden API — evaluation & migration plan

**Status: Phase 1 (pilot/evaluation) complete, 2026-09-11. Not yet wired into the live app.**
**Pilot code:** [`js/espn.js`](../js/espn.js) — implemented, parse-tested against real ESPN
responses (see Pilot Results below), but not imported by any other file yet.

## Why this file exists

A prior session did this same evaluation and the findings only lived in conversation/plan-mode
memory — lost when that session ended. This file is the fix: durable, committed, so the next
session (or the next me) can pick up from here instead of re-discovering all of this from scratch.

## The problem being solved

The dashboard currently stitches together three data sources, each with real friction:

- **TheSportsDB V1** (free key) — CORS-blocked from the browser for most leagues.
- **TheSportsDB V2** (premium key, proxied through `worker/rundown-proxy.js`) — works for team
  lookup/schedule, but has **no standings endpoint at all** — confirmed empty for both NFL and CFB,
  every season tested, via `lookuptable.php`.
- **TheRundown** (paid/metered, proxied through the same worker) — used as the standings/rankings
  workaround (CFB's AP Top 25, NFL's division records) and for live in-game state. Free tier caps at
  20,000 data points/day, shared across all 8 leagues.

**That budget ran out today.** Confirmed live during this evaluation (2026-09-11):

```
$ curl https://team-dashboard-rundown-proxy.boxscore.workers.dev/teams/1   # CFB
HTTP 429 {"error":"Daily data point limit reached","limit":20000,"used":20018,...}
$ curl https://team-dashboard-rundown-proxy.boxscore.workers.dev/teams/2   # NFL
HTTP 429 {"error":"Daily data point limit reached","limit":20000,"used":20018,...}
```

Right now, CFB rankings, NFL standings, and live in-game state are all down for every drafter until
TheRundown's daily quota resets. This isn't a hypothetical risk being evaluated for later — it's the
live state of the app as this plan was written, and it's the direct motivation for finding a
non-metered replacement.

## Recommendation

**Migrate standings/rankings (CFB, NFL) to ESPN's hidden API.** It has no key, no observed rate
limit, and open CORS on every endpoint this app actually needs — which also means it can be called
straight from the browser, no worker proxy required, for the parts piloted here. Treat schedule/team
detail (currently SportsDB V2) as a **separate, lower-priority** later phase — SportsDB V2 already
works for that and isn't rate-limited the way TheRundown is, so there's no burning reason to touch it
yet. Keep TheRundown for one thing only, for now: live in-game clock/score state, which is out of
scope for this evaluation and still working.

## Verified findings

Base host: `https://site.web.api.espn.com` (not the older `site.api.espn.com` — confirmed the two
hosts return byte-identical data for shared paths during this session, so use `.web.` going forward).

| Endpoint | Status | CORS (`Origin: https://boxscorethedraft.pages.dev`) | Notes |
|---|---|---|---|
| `/apis/v2/sports/football/nfl/standings` | ✅ Real, live-accurate | ✅ `access-control-allow-origin: *` | **Conference-level only** — see correction below |
| `/apis/site/v2/sports/football/college-football/rankings` | ✅ Real, rich | ✅ open | 5 polls (AP, Coaches, FCS Coaches, D2/D3 Coaches); rank/prev/trend/points/firstPlaceVotes/record all present |
| `/apis/site/v2/sports/football/nfl/scoreboard` | ✅ Real, live | ✅ open (assumed, same host pattern) | Used to cross-check standings freshness (below) |
| `/apis/site/v2/sports/football/nfl/teams/{id}` | ✅ Real | ✅ open | Team detail |
| `/apis/site/v2/sports/football/nfl/teams/{id}/schedule` | ✅ Real | ✅ open (assumed) | Full season, results + upcoming, clean shape (see Pilot Results) |
| `/apis/site/v2/sports/football/nfl/teams/{id}/injuries` | ❌ **Broken — always returns `{}`** | ✅ open (but moot) | Tested on 2 teams (PHI, KC — both active with real Week 1 injuries in reality). Real injury data requires the hypermedia "core" API instead — see correction below |
| `/apis/common/v3/sports/football/nfl/athletes/{id}/overview` | ✅ Real, rich | not tested (not part of this pilot) | keys: `fantasy`, `gameLog`, `news`, `nextGame`, `rotowire`, `statistics` |
| `/apis/site/v2/sports/football/nfl/teams` (bulk list) | ✅ Real, but... | ❌ **no CORS headers** | Confirmed no `access-control-allow-origin` at all — matches the original caveat. Also needs `?limit=1000`-ish; CFB's version defaults to `limit=400` and silently truncates (see below) |

### Corrections to the initial evaluation

These are things the *original* pass at this evaluation got wrong or didn't check closely enough —
worth flagging explicitly so the next phase doesn't repeat the assumption:

1. **NFL standings is conference-level, not division-level.** `entry.team` on
   `/apis/v2/sports/football/nfl/standings` carries no division field — the response nests exactly
   one level (AFC / NFC, 16 teams each), not conference → division. The dashboard's current
   (uncommitted) NFL standings feature groups by division (AFC North, NFC West, etc., via
   TheRundown's `division` field) — matching that with ESPN requires the **hypermedia "core" API**
   (`sports.core.api.espn.com`) instead, which is a materially bigger build:
   - Conference group → 4 division-group `$ref`s each (confirmed group IDs: AFC East=4, North=12,
     South=13, West=6; NFC East=1, North=10, South=11, West=3 — these are static, don't need
     rediscovering)
   - Each division group's `.standings` is itself a `$ref` to a list of standings *types*
     (overall/playoff/expanded/vs-division)
   - The "overall" one (`.../standings/0`) finally has the real per-team `records[].summary`
     (e.g. `"0-0"`) — but team identity there is *itself* a further `$ref` to `/teams/{id}`
   - **CORS is open at every level of this chain** (confirmed on `/groups/4` and one division's
     `/standings`), so it's technically fetchable client-side — it's just 8 requests (one per
     division's "overall" standings) instead of 1, plus a one-time static ESPN-team-id →
     name/abbreviation table (same pattern as this app's existing `sportsdbId`/`rundownTeamId`
     fields) to avoid resolving 32 more `$ref`s on every refresh.
   - **Open question for the next phase:** is division grouping worth 8 calls + a maintained ID
     table, or is conference-only (what the flat endpoint already gives, for free) good enough? The
     flat version is still strictly better than the status quo (real, live, unmetered) even without
     divisions.

2. **The injuries endpoint doesn't work.** `/apis/site/v2/sports/football/nfl/teams/{id}/injuries`
   returns `{}` for every team tested, including ones with real Week 1 injuries. Real injury data
   lives at `sports.core.api.espn.com/v2/.../teams/{id}/injuries` — also hypermedia, also paginated
   (56 injuries across 3 pages of `$ref`s for one team, each needing its own follow-up fetch for the
   actual injury detail). CORS is open there too, but this is a much heavier feature than "one fetch
   per team" — **not worth pursuing for this pilot's scope**; drop it from the near-term plan
   entirely rather than half-build it.

3. **The bulk `/teams` list needs `?limit=1000`, not the default.** CFB's team list defaults to
   `limit=400` and silently truncates — with the default, Oregon (a team currently in this
   dashboard's roster) doesn't appear in the first 400 results at all. `?limit=1000` returns all 762
   CFB teams (FBS+FCS+D2+D3). Anyone building the one-time ID-mapping lookup needs to know to pass
   this explicitly.

4. **ESPN team IDs do not line up with TheRundown's team IDs** — checked directly: Arizona is
   TheRundown `125` vs ESPN `12`; Georgia is TheRundown `153` vs ESPN `61`; Texas A&M is TheRundown
   `218` vs ESPN `245`. (Ohio State happened to be `194` in both — pure coincidence, confirmed by the
   mismatches above; don't rely on ID reuse anywhere.) Any real migration needs its own fresh
   ESPN-id mapping table, built the same way `sportsdbId`/`rundownTeamId` were: one-time, via `curl`,
   never trusting a coincidental ID match.

### Confirmed still accurate from the original evaluation

- No API key, no observed rate limit (10+ requests fired across this session with no throttling or
  errors — it's espn.com's own CDN).
- Undocumented/unofficial, no SLA, could change or restrict without notice; technically outside
  ESPN's ToS for reuse, unenforced for tiny non-commercial hobby traffic — the same well-trodden
  pattern the OSS fantasy-dashboard space already relies on. This app is ~10 people, non-commercial;
  the risk profile is low, but it's not zero — see "What to keep in reserve" below.

## Pilot results — field-for-field verification

### CFB: AP Top 25 vs. what's live today

ESPN's `AP Top 25` poll, fetched live (2026-09-11):

| Rank | Team | Record | Trend | 1st-place votes |
|---|---|---|---|---|
| 1 | Ohio State | 1-0 | – | 46 |
| 2 | Georgia | 1-0 | +1 | 0 |
| 3 | Notre Dame | 1-0 | +1 | 4 |
| 4 | Texas | 1-0 | +1 | 2 |
| 5 | Indiana | 1-0 | +1 | 8 |

This is strictly richer than what TheRundown's `ranking` field gives today (a bare `1`–`25` integer,
no trend, no votes, no points). Two of this dashboard's drafted CFB teams (Ohio State, Georgia) are
both currently ranked — real, plausible Top-5 placement. Couldn't diff this directly against
TheRundown's live values for the same teams because TheRundown is the thing that's down right now
(see the 429s above) — but the *shape* matches what `js/standings-cfb.js`'s `computeCfbRankingTable`
already expects (a rank number + record string per team), so wiring it in is a data-source swap, not
a UI rewrite.

### NFL: standings vs. actual final scores

Cross-checked ESPN's standings against ESPN's own scoreboard for the two Week 1 games that had
finished as of this pilot, to confirm the standings endpoint isn't stale/cached:

| Team | Scoreboard result | Standings W-L | Standings PF-PA | Streak |
|---|---|---|---|---|
| Seattle | beat NE 13-10 | 1-0 | 13-10 | +1 |
| LA Rams | lost to SF 7-27 | 0-1 | 7-27 | -1 |
| Philadelphia, Dallas, KC, LA Chargers (hadn't played yet) | — | 0-0 | 0-0 | — |

Standings updated correctly and immediately for the teams that had played, and correctly still
showed 0-0 for teams whose Week 1 game hadn't happened yet — this is live, accurate data, not a
cached/stale snapshot. Verified via a real parse of the actual JSON (not eyeballed) — see
`fetchEspnNflStandings` in `js/espn.js`, which is the exact code that produced this table.

## Proposed phasing

**Phase 1 — pilot & evaluate (this document + `js/espn.js`).** Done.

**Phase 2 — wire CFB rankings into the live UI.** Lowest-risk first move: replace
`computeCfbRankingTable`'s TheRundown-sourced `ranking` field with `fetchEspnCfbRankings()`'s output
in `js/standings-cfb.js`. Keep win/loss `record` on TheRundown for now (smaller diff, and TheRundown
still works for that once its quota resets) — only swap the ranking source. Needs: a name-matching
step between ESPN's `location`/`teamName` and this app's `TEAM_META[...].name` (most match directly —
"Ohio State", "Georgia", "Texas A&M" all match ESPN's `team.location` verbatim — but a few won't
(e.g. IU's `meta.name` is `'IU'`, ESPN's `location` is `'Indiana'`) and need explicit overrides,
same as `abbrFromName`'s existing fallback pattern for undrafted teams.

**Phase 3 — wire NFL standings into the live UI, conference-only first.** Swap
`js/standings-nfl.js`'s TheRundown-sourced win/loss/streak/PF/PA for `fetchEspnNflStandings()`'s
output. Ship conference-grouped (AFC/NFC, 16 teams each) rather than blocking this phase on the
division hypermedia chain from finding #1 above — re-evaluate division grouping as a follow-up once
conference-level is live and proven stable, not before.

**Phase 4 (later, lower priority) — decide on NFL division standings.** Build the 8-call hypermedia
chain + static ESPN-team-id table if the conference-only view in Phase 3 turns out to feel like a
downgrade in practice. Not urgent — TheSportsDB has never had this data at all, so conference-only
ESPN is already a net improvement over what division grouping *would* have needed before this
evaluation (TheRundown, still metered).

**Phase 5 (separate, not urgent) — schedule/team detail off SportsDB V2.** ESPN's
`/teams/{id}/schedule` and `/teams/{id}` are real, clean, and CORS-open — a plausible full
replacement for the SportsDB V2 calls currently proxied through the worker (`fetchSportsDbV2Team`/
`fetchSportsDbV2Schedule` in `js/api.js`). Deliberately **not** part of this pilot's scope — SportsDB
V2 isn't the thing that's on fire today, so there's no urgency, and touching it means rebuilding the
`sportsdbId` → ESPN-id mapping for every drafted team across every league (bigger lift than the two
standings pilots above). Revisit once Phases 2-3 have proven out in production.

**What NOT to do:** don't pursue ESPN's injuries endpoint (finding #2 — broken at the simple layer,
disproportionately expensive at the real layer) or the athlete-overview endpoint (never asked for,
no current UI surface needs it) as part of this migration. They're real and verified working, but
they're new capabilities nobody requested, not fixes for something broken today — building them now
would be scope creep beyond what this evaluation set out to do.

## What stays on TheRundown

Live in-game state (`fetchRundownEventForTeam`, `isRundownEventLive` in `js/api.js`) is unaffected by
this plan — it's a different problem (real-time score/clock while a game is in progress) that wasn't
evaluated here. ESPN's scoreboard endpoint likely covers this too (it already showed
`STATUS_FINAL`/live status fields during this pilot), but that's its own follow-up, not bundled into
the standings/rankings migration above.

## If this holds up: what Phase 2+ removes

Every standings/rankings call that moves to ESPN is one that (a) no longer touches the 20,000/day
TheRundown budget, and (b) no longer needs `worker/rundown-proxy.js` at all — CORS is open, so it's a
direct browser fetch, zero proxy code. If Phases 2-4 all land, `worker/rundown-proxy.js` shrinks to
just the League Facts KV store (job #2 in its own header comment) plus whatever's left of the
TheRundown live-state proxy — worth revisiting that file's own header comment once this migration is
further along, since large chunks of "why this worker exists" will no longer apply.
