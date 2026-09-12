# ESPN hidden API — evaluation & migration plan

**Status: everything below is live except College Basketball (see "Second migration wave," phase E) —
every league now reads ESPN for standings/rankings, schedule, and live in-game state except CBB (no
ESPN integration built for it yet). TheSportsDB has no remaining callers in normal operation at all —
see "SportsDB fully deprecated (2026-09-12)" below.**
**Code:** [`js/espn.js`](../js/espn.js) and [`js/standings-flat.js`](../js/standings-flat.js), wired
into every league's own `js/standings-*.js` file and `js/live-data.js`.

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

## EPL phase (added 2026-09-11, outside this plan's original NFL/CFB scope)

Migrated EPL's league table from TheSportsDB V1 (`lookuptable.php`, routed through
`worker/rundown-proxy.js`'s now-removed `/sportsdb/table/:leagueId/:season` route) to ESPN's hidden
API, on request, once the NFL/CFB pattern above had already proven out. Unlike NFL/CFB, TheSportsDB's
table endpoint actually worked for EPL (it's the one league that had real standings from it) — this
wasn't a broken-data fix like Phases 2-3, just consolidating onto the one already-adopted API and
dropping a worker route (and its premium-key dependency) that only EPL used.

**Endpoint:** `GET https://site.web.api.espn.com/apis/v2/sports/soccer/eng.1/standings` — same
`site.web.api.espn.com` host as NFL/CFB, same open CORS (`access-control-allow-origin: *`), no key. A
single-table league only has one standings type, so (unlike NFL's conference split) the real per-team
rows are one level shallower: `data.children[0].standings.entries[]`, not `data.children[].standings...`
per group.

**Field parity, verified against a live pull (2026-09-11) covering all 20 currently-drafted clubs:**
every field the Standings tab, board cards, the team modal, and the League Facts rank-auto rules used
from TheSportsDB's table (rank, wins, draws, losses, points) has a direct ESPN equivalent
(`stats[name=rank/wins/ties/losses/points].value`). ESPN's table is a strict superset — it also
carries `gamesPlayed`, `pointDifferential` (goal difference), `pointsFor`/`pointsAgainst` (goals
for/against), and a qualification/relegation `note.description` (e.g. "Champions League", "Europa
League", "Relegation") that TheSportsDB's table never exposed at all. None of those extra fields are
wired into the UI yet — this migration was a straight data-source swap, not a feature addition; adding
a zone-color treatment to the standings table would be a reasonable, separate follow-up.

**ID mapping:** ESPN's team ids don't line up with TheSportsDB's `sportsdbId` (same "don't trust ID
reuse" lesson as finding #4 above), so matching now goes by club name instead — reusing
`findDraftedTeamByName` from `js/utils.js` unchanged (already the match strategy the old EPL code used
for turning a table row into a drafted team). No EPL-specific override table was needed, unlike
CFB/NFL: `findDraftedTeamByName`'s `normalizeTeamName` helper already carries a `'man city'`/
`'man united'` alias from an earlier fix, which happens to be the only pair of the 20 drafted clubs
whose ESPN name ("Manchester City"/"Manchester United") doesn't substring-match this app's shortened
`meta.name` ("Man City"/"Man United"). Everything else — including clubs this app abbreviates
differently, like "Newcastle" (ESPN: "Newcastle United") and "Brighton" (ESPN: "Brighton & Hove
Albion") — matches through the plain substring rule, confirmed against the live pull.

**Follow-up (same day):** the "reasonable, separate follow-up" mentioned above landed almost
immediately — EPL's schedule (Most Recent Result / Next Match) moved off TheSportsDB V2's
`schedule-previous`/`schedule-next` onto ESPN's `teams/{id}/schedule` (default call = played matches
this season, `?fixture=true` = every remaining fixture), and the standings' zone field got wired into
the team card as a colored tag. Same call count per team as before (2 schedule calls), but each now
carries a real venue name and TV broadcast that TheSportsDB never had — see `fetchEspnTeamSchedule`
in `js/espn.js` and `renderForm`/`renderNext`/`renderRowStatus` in `js/live-data.js`. Added a "Form"
strip (last 5 results as pills) computed client-side from the same schedule response — no extra
request. This club's ESPN team id is resolved the same way `findEspnEplRow` already does for the stat
strip (by name, through the standings cache), not a new stored field, so `fetchTeamBundle` awaits
`fetchEplStandingsTable()` before fetching the schedule. Deliberately left out: DraftKings odds (also
available on ESPN's per-match `summary` endpoint) — the CSS already has a `.nm-prob` slot that looks
built for exactly this, but showing a sportsbook line in a friend-group fantasy app was called a tone
decision, not a technical one, and shelved for now.

## What stays on TheRundown

**Superseded — see "Second migration wave" and "SportsDB fully deprecated" below.** Live in-game state
moved off TheRundown too, onto ESPN's scoreboard endpoint, for every league that has an ESPN
standings-based team-id mapping (EPL, NFL, CFB, NBA, NHL, MLB, WNBA). TheRundown's only remaining
caller in normal operation is College Basketball (no ESPN integration built for it yet — see that
section); CFB's NDSU no longer needs it (see below) but a defensive fallback to it stays in place for
if ESPN's per-team fetch for NDSU ever fails on a given refresh.

## If this holds up: what Phase 2+ removes

Every standings/rankings call that moves to ESPN is one that (a) no longer touches the 20,000/day
TheRundown budget (or, for EPL, the premium TheSportsDB key's own limits), and (b) no longer needs
`worker/rundown-proxy.js` at all — CORS is open, so it's a direct browser fetch, zero proxy code. The
EPL phase already did this: its `/sportsdb/table/:leagueId/:season` route (and the now-unused
`sportsdbTable` cache TTL) are removed from the worker entirely, since EPL was the only league that
ever called it. If Phases 2-4 all land too, `worker/rundown-proxy.js` shrinks further to just the
League Facts KV store (job #2 in its own header comment), the one-off TheSportsDB V1 admin lookup, the
V2 team/schedule proxy, and whatever's left of the TheRundown live-state proxy — worth revisiting that
file's own header comment once this migration is further along, since large chunks of "why this worker
exists" will no longer apply.

## Second migration wave (2026-09-12): remaining leagues + live state off TheRundown

A full review of every remaining SportsDB/TheRundown call site (requested after the EPL phase above
landed) turned into five more phases, executed in one session and merged together. Reviewed in order:

**A — NBA/NHL/MLB/WNBA standings.** These 4 leagues had *no* standings source at all before this —
TheSportsDB's free tier never carried real standings for them, so the Standings tab just said "No data
available." `apis/v2/sports/{sport}/{league}/standings` (same flat, conference-grouped shape NFL
already used) works identically for all 4 — verified live. Pure upside, zero regression risk, so this
shipped first. Rather than duplicate NFL's ~30-line fetcher four more times, `fetchEspnFlatStandings`
in `js/espn.js` factors out the shared "walk `children[].standings.entries[]`" logic (NFL's own
fetcher was refactored onto it too), and `js/standings-flat.js` factors out the shared cache/toggle/
render engine every one of these 4 leagues' `js/standings-nba.js`/`-nhl.js`/`-mlb.js`/`-wnba.js` files
build on top of — each of those is now a thin, sport-specific config (record formatting, sort order,
how the "Person" combined record is built) rather than a second copy of NFL's whole file.

Matching an ESPN row back to a drafted team turned out to need an **exact** match (after
`normalizeTeamName`), not EPL/CFB's looser substring rule (`findDraftedTeamByName` in `js/utils.js`) —
tried the substring rule first here and it produced a real false positive: "Nets" is a literal
substring of "Hornets", so Charlotte Hornets matched to the Brooklyn Nets on the standings table. Fixed
by adding `findFlatTeamKey` (exact-match only) in `js/standings-flat.js`, plus two aliases in
`TEAM_NAME_ALIASES` (`js/utils.js`) for the only two of 120 drafted teams that don't match ESPN's plain
nickname (`team.name`) exactly: "Mavs" vs "Mavericks", "Blazers" vs "Trail Blazers". Also caught: ESPN
rows had to expose that nickname as a separate `teamNickname` field alongside the full `teamName`
("Cleveland Cavaliers") used for display — matching against the full name would need substring logic
again, reintroducing the same bug.

**B — NBA/NHL/MLB/WNBA schedule.** Same `fetchEspnTeamSchedule` EPL already used (see below), just
pointed at each league's own sport/league slug. One real cross-sport gap found while building this:
the `?fixture=true` flag's behavior isn't consistent — for soccer it genuinely splits (default =
played only, `?fixture=true` = remaining only), but for MLB *both* calls return the full ~165-game
season regardless. Fixed by not trusting the flag at all: `fetchEspnTeamSchedule` now merges both
responses by event id and does the real recent/upcoming split itself off each event's own `completed`
flag. A second bug surfaced by this: the Cubs' real schedule has three `STATUS_POSTPONED` games
(April, June) that are permanently "incomplete" but dated months in the past — without a date guard
those sorted to the front of "upcoming," so `fetchEspnTeamSchedule` now also requires an upcoming
event's date to be `>= now`.

**C — CFB records off TheRundown.** The AP Top 25 moved to ESPN back in Phase 2 above; the full-roster
win-loss record (board card, team modal, "Person" view) was still TheRundown's `/teams/{sportId}`.
ESPN's own `college-football/standings` covers this — but only for the 124 FBS teams across 11
conferences, not FCS. This app has exactly one drafted FCS team (NDSU), so `findCfbRecord` in
`js/standings-cfb.js` tries ESPN first and falls back to the existing TheRundown cache only when ESPN
has no row — the other 29 of 30 drafted CFB teams never touch TheRundown for this anymore. One data
shape surprise: unlike NFL/NBA/NHL/MLB, CFB's stats array has no flat `losses` field at all (confirmed
live) — only several named per-split records (home, division, vs-AP-ranked, etc.), one of which
(`overall`) carries a `summary` string like `"1-0"`. `fetchEspnCfbFullStandings` parses that the same
way `parseWinLossRecord` already parses TheRundown's identically-shaped record string.

**D — NFL/CFB schedule off SportsDB V2.** Folded into the same `FLAT_SCHEDULE_LEAGUES` map in
`js/live-data.js` that EPL/NBA/NHL/MLB/WNBA already used, rather than a separate code path — the only
wrinkle was making sure NDSU (no ESPN row, from phase C) falls through to the *existing* generic
TheSportsDB branch instead of ending up with no schedule at all: `fetchTeamBundle`'s ESPN-schedule
branch only commits (and `return`s) once `findRow(meta)` actually resolves a row; otherwise it falls
through to the code below exactly as it did before this phase existed.

**E — Live in-game state, all leagues, off TheRundown.** The last TheRundown dependency for every
league except College Basketball. `fetchEspnScoreboard(sportPath)` (`js/espn.js`) is one request per
league covering every team's current game at once (mirrors `rundownDayCache`'s "one shared fetch, not
one per team" shape in `js/api.js`) — `competitions[0].status.type.state` is `'in'` for a game actually
in progress, `'pre'`/`'post'` otherwise, and each competitor already carries a live `score`, so no
second polling endpoint is needed. `findEspnScoreboardLine` normalizes that into the same
`{isHome, own, opp, opponentName, period}` shape `rundownEventLine` already built from TheRundown, so
`renderStats`/`renderForm`/`renderNext`/`renderRowStatus` in `js/live-data.js` just gained a
`bundle.espnLive` check ahead of their existing `bundle.rundownEvent` one, rather than a parallel
rewrite. Verified against a real live window (2026-09-12, four MLB games actually in progress) rather
than just structurally: San Diego at San Francisco correctly showed `LIVE 7-5 · Bot 5th` on both the
board pill and the team modal, live, mid-game.

**What this leaves on TheRundown:** College Basketball (no ESPN integration built for it at all yet —
it has no standings/schedule source today either, TheSportsDB never carried it; giving it the same
treatment as the other 7 leagues is a real follow-up but a bigger lift, since there's no existing
schedule/standings scaffolding to extend the way there was here). CFB's NDSU no longer needs it — see
"SportsDB fully deprecated" below. Every other league's per-team live/schedule/record fetch no longer
touches TheRundown's shared daily quota at all.

## SportsDB fully deprecated (2026-09-12)

Audited every remaining TheSportsDB call site after the second migration wave above, prompted by a
direct ask to confirm the API could be fully retired. Two real gaps turned up, both now closed:

1. **NDSU (CFB) never actually needed to fall back to TheSportsDB.** Phase D above accepted NDSU
   falling through to the generic TheSportsDB schedule branch since ESPN's FBS-only standings endpoint
   has no row for an FCS program. But ESPN's *individual* team endpoint
   (`/apis/site/v2/sports/football/college-football/teams/{id}?enable=record`) works for any team id
   regardless of division — confirmed live for NDSU (espn id `2449`), CORS-open, same host family as
   `fetchEspnTeamSchedule`. Added `fetchEspnCfbTeamRecord` (`js/espn.js`) and inject its result as a
   plain extra row into `espnCfbRecordsCache.rows` (`js/standings-cfb.js`'s `NDSU_ESPN_TEAM_ID`/
   `fetchEspnCfbRecordsCached`) — `findEspnCfbRow`/`findCfbRecord` and `FLAT_SCHEDULE_LEAGUES.cfb`'s
   `findRow` in `js/live-data.js` all pick it up for free from there, so NDSU now gets a real record,
   AP-rank lookup, and full ESPN schedule (with real venue/broadcast) exactly like every FBS team,
   and never reaches the TheSportsDB branch in `fetchTeamBundle` in normal operation. TheRundown's
   `cfbRecordsCache` fallback in `findCfbRecord` stays as a defensive fallback for if this one team's
   fetch ever fails on a given refresh — everything else in this app's "graceful degradation instead
   of a hard dependency" pattern works the same way.

2. **The same audit found a second, unrelated FBS-standings gap while checking every drafted team
   against a live pull:** `fetchEspnCfbFullStandings`'s conference walk only read `standings.entries`
   directly off each conference node — true for 10 of ESPN's 11 CFB conferences, but the Sun Belt
   Conference nests its East/West divisions one level deeper instead (confirmed live: the top-level
   "Sun Belt Conference" node has 0 direct entries but 2 child groups that do), so all ~14 Sun Belt
   teams silently had no row at all — caught via James Madison (`ericprister_jamesmadison`) showing no
   record despite being FBS. Fixed by making that walk recurse into `children` when a conference has no
   direct entries, rather than a one-off special case for Sun Belt specifically.

3. **The bigger volume fix: `fetchTeamBundle`'s ESPN-schedule branch (`js/live-data.js`) was still
   fetching TheSportsDB's `info` (team bio: Sport/Founded/Stadium) unconditionally for every team that
   resolves via ESPN** — i.e. every drafted team in all 7 migrated leagues, every refresh tick. But
   `renderStats` always renders that league's real ESPN record branch first and returns before ever
   reaching the `bundle.info` fallback, for every league with an ESPN branch — so that fetch's result
   was never actually displayed for any team on this path. Removed the `fetchTeamInfoCached` call from
   that branch entirely; it's still fetched by the generic legacy branch below it, which remains the
   real fallback for any future team that doesn't resolve an ESPN row at all.

With NDSU (1) and Sun Belt (2) both fixed, every one of this app's currently drafted teams across all
7 ESPN-migrated leagues resolves a real ESPN row — verified by cross-checking all ~200 drafted teams'
`TEAM_META` names against a live pull of each league's ESPN standings/matching field. That means
`fetchTeamBundle`'s generic TheSportsDB branch (`fetchSportsDbV2Team`/`fetchSportsDbV2Schedule`/
`API_BASE`'s v1 `lookupteam.php`/`eventslast.php`/`eventsnext.php`) is provably unreachable for the
current roster — kept only as scaffolding for a genuinely new future gap (e.g. next season's draft
picking up another lower-division team), the same reasoning that already kept TheRundown's NDSU
fallback in place after (1). Nothing in this app makes a TheSportsDB call in normal operation today.

**Bonus fix found by the same audit: most NBA/NHL/MLB/WNBA teams' modals were showing a permanent
"not hooked up yet" placeholder instead of real data, unrelated to TheSportsDB.** Only Josh's own 21
teams were ever given a real `sportsdbId`/`rundownTeamId` in `TEAM_META` — every other drafter's team
in those 4 leagues (~100 teams) has neither field, a pre-existing gap that predates this migration.
Their board-card record already worked (it comes from `js/standings-flat.js`'s name/nickname matching,
independent of `sportsdbId`), but `openTeamModal`'s `hasLive` gate and `fetchTeamBundle`'s ESPN branch
were both still keyed on `meta.sportsdbId`/`meta.rundownTeamId` being set, wrapping the *entire* ESPN
path in `if(meta.sportsdbId)` — so a team with a real ESPN row but no `sportsdbId` never got there at
all. Fixed by moving the `FLAT_SCHEDULE_LEAGUES` check (and its own `if(row)` gate) ahead of the
`sportsdbId`/`rundownTeamId` check in `fetchTeamBundle`, and adding
`!!FLAT_SCHEDULE_LEAGUES[meta.leagueKey]` to `hasLive` in `openTeamModal` — both in `js/live-data.js`.
Verified live: the Brewers (`drew_brewers`, no sportsdbId) now show a real 92-56 record, form strip,
last result, and next match with real venue/broadcast, same as any team with a `sportsdbId` always did.
Scoped to the 7 `FLAT_SCHEDULE_LEAGUES` leagues only — College Basketball still has no ESPN integration
at all (see phase E), so its teams without a `rundownTeamId` still show the placeholder, correctly:
there's genuinely no data source for them yet.
