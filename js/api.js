/* ============================================================
   LIVE DATA: TheSportsDB v1 API
   Using the public free test key "123" — rate-limited to 30
   requests/min. Each team's data is cached in memory (and mirrored to
   localStorage — see LIVE_DATA_CACHE_KEY in js/live-data.js) after its
   first fetch and refreshed on a staggered background schedule (see
   js/live-data.js) rather than re-fetched on every click, so opening a
   team you've already viewed is instant, even across browser sessions.
   If you upgrade to a premium key later (thesportsdb.com,
   ~$9/mo), just swap the "123" below for your own key.
   ============================================================ */
export const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123/';

/* ============================================================
   DASHBOARD WORKER: shared Cloudflare Worker — see
   worker/rundown-proxy.js for the two things it does:

   1. Proxies a handful of TheRundown requests (its API key can't be
      embedded in client JS the way TheSportsDB's public test key
      can). TheRundown supplements — never replaces — TheSportsDB:
      it adds live in-game state (score/clock while a match is
      actually in progress), which TheSportsDB's free tier doesn't
      have. Only teams with a rundownTeamId set in js/data.js (see
      RUNDOWN_SPORT_ID below for which leagues that covers so far)
      get this; everyone else is untouched.
   2. Stores the League Facts data (see js/league-facts.js) in Workers
      KV so a mark made by one drafter is visible to everyone, instead
      of sitting in just their own browser's localStorage.

   Leave DASHBOARD_WORKER_BASE empty to turn both off — the
   TheRundown lookups become a no-op (teams fall back to their
   existing TheSportsDB-only display) and League Facts falls back to
   localStorage-only (not shared, but still functional).
   ============================================================ */
export const DASHBOARD_WORKER_BASE = 'https://team-dashboard-rundown-proxy.boxscore.workers.dev';

import { fetchJSON } from './utils.js';

// Which TheRundown sport_id each leagueKey maps to. Only leagues
// listed here get the live in-game-state supplement — add a league
// only after its rundownTeamId mappings have been verified against
// real fixtures (see worker/rundown-proxy.js's /teams/{sportId}).
export const RUNDOWN_SPORT_ID = {
  epl: 11,
  mcbb: 5,
  nfl: 2,
  nba: 4,
  nhl: 6,
  mlb: 3,
  wnba: 8,
  cfb: 1
};

// TheRundown event_status values that mean "the game is happening
// right now" — see https://docs.therundown.io/reference — as
// opposed to STATUS_SCHEDULED (hasn't started) or STATUS_FINAL /
// STATUS_POSTPONED / STATUS_CANCELED (already over / not happening).
export const RUNDOWN_LIVE_STATUSES = new Set(['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD']);

/* ---- Adding a new league or per-team data source: keep this scalable ----
   The patterns below (rundownDayCache right after this comment,
   eplStandingsCache in js/standings-epl.js, LIVE_TEAM_KEYS/
   backgroundRefreshTick in js/live-data.js) are deliberate, not
   incidental — follow them for anything new rather than reinventing a
   fetch path:

   1. Data shared by every team in a league (a day's slate, a standings
      table) belongs in ONE cache keyed by leagueKey (+date, if it's
      date-scoped) — mirror rundownDayCache / eplStandingsCache. Never
      let each team fetch and store its own copy of the same
      league-wide payload; that's what turns "add 27 more CFB teams"
      into "27 more calls" instead of zero.
   2. Data that's genuinely per-team (last result, next fixture) rides
      the existing staggered refresh loop (LIVE_TEAM_KEYS /
      backgroundRefreshTick) — don't add a second polling loop. If it
      adds calls to the per-tick SportsDB budget, bump
      SPORTSDB_CALLS_PER_TEAM_TICK so REFRESH_CYCLE_MS keeps stretching
      out correctly as the roster grows.
   3. Anything that should survive a reload goes in its own per-entity
      localStorage key (prefix + id), not one growing blob — mirror
      LIVE_DATA_CACHE_PREFIX / TEAM_INFO_CACHE_PREFIX in js/live-data.js.
   4. Pick each cache's TTL to match how fast that data actually
      changes (static info -> hours, live scores -> ~1min, standings ->
      ~15min) — and use that SAME number for CACHE_TTL_SECONDS on
      whichever Worker endpoint backs it (see worker/rundown-proxy.js),
      so the two layers agree on freshness instead of each guessing
      separately.
   5. If a league's data shape or endpoint is unverified, pilot it on
      2-3 teams and diff against a known-good source before rolling it
      out league-wide — same approach EPL's V1->V2 migration used (see
      V2_MIGRATED_LEAGUES below).
   6. If the credential behind it is private/paid (not a public test
      key), it MUST be proxied through the Worker, never shipped in
      client JS — see the Worker-side checklist in
      worker/rundown-proxy.js next to CACHE_TTL_SECONDS. */

// A day's full slate for a league rarely changes within a few
// minutes, and every team in that league shares one slate — so this
// caches by leagueKey+date for a short TTL rather than re-fetching
// per team. Keeps live-score staleness bounded to ~1 minute while
// still collapsing near-simultaneous requests (e.g. a background
// tick and a modal open) into one network call.
const RUNDOWN_CACHE_TTL_MS = 60 * 1000;
const rundownDayCache = {};

export async function fetchRundownDayEvents(leagueKey, dateStr){
  const sportId = RUNDOWN_SPORT_ID[leagueKey];
  if(!DASHBOARD_WORKER_BASE || !sportId) return null;

  const cacheKey = `${leagueKey}:${dateStr}`;
  const cached = rundownDayCache[cacheKey];
  if(cached && (Date.now() - cached.fetchedAt) < RUNDOWN_CACHE_TTL_MS) return cached.data;

  try {
    const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/events/${sportId}/${dateStr}`);
    rundownDayCache[cacheKey] = { data, fetchedAt: Date.now() };
    return data;
  } catch(err) {
    console.warn('[TheRundown]', leagueKey, 'events fetch failed', err);
    return null;
  }
}

export function findRundownEventForTeam(dayEvents, rundownTeamId){
  if(!dayEvents || !dayEvents.events || !rundownTeamId) return null;
  return dayEvents.events.find(e => (e.teams || []).some(t => t.team_id === rundownTeamId)) || null;
}

export function isRundownEventLive(event){
  return !!event && RUNDOWN_LIVE_STATUSES.has(event.score && event.score.event_status);
}

// Looks up today's TheRundown event for a team, if that team's
// league has been migrated (RUNDOWN_SPORT_ID) and has a
// rundownTeamId set. Uses the viewer's UTC date, same as TheRundown's
// day boundary — a game starting right at that boundary may show up
// a refresh cycle late, which self-corrects on the next tick.
export async function fetchRundownEventForTeam(meta){
  if(!meta.rundownTeamId || !RUNDOWN_SPORT_ID[meta.leagueKey]) return null;
  const today = new Date().toISOString().slice(0, 10);
  const dayEvents = await fetchRundownDayEvents(meta.leagueKey, today);
  return findRundownEventForTeam(dayEvents, meta.rundownTeamId);
}

// ---- TheSportsDB V2 migration (see the migration plan) ----
// Phase 3, batched by league: only leagues listed here read from V2
// (via the worker proxy, premium key held server-side) — everyone
// else stays on V1 until their league's batch lands, verified against
// real data first. EPL is fully migrated (Phase 2 piloted it on
// Liverpool/Newcastle, side-by-side-diffed against V1, then the rest
// of the league followed once that checked out). CFB followed the same
// pattern: piloted against the live worker on Oregon (both directions
// of the schedule endpoint returned correct real results/fixtures,
// field-for-field matching V1's shape) plus a handful of others
// (Texas A&M, Arizona, Ohio State, Georgia) before batching in the
// rest of the league — CFB's V1 path was CORS-blocked from the
// browser anyway, so this also fixes Last Result/Next Game actually
// populating for these teams. Remove this list entirely (and the V1
// branch it feeds) once every league has migrated — Phase 4.
//
// IMPORTANT — this only matters for NFL/NBA/NHL/MLB/WNBA/College BB,
// the leagues still on V1 from before the premium key existed. Any
// LEAGUE ADDED FROM NOW ON must be wired straight onto V2 (added here
// immediately, never left on the V1 branch to "migrate later")
// — we're paying for the premium SportsDB key specifically so new
// integrations don't inherit V1's free-tier CORS breakage (the exact
// bug that left CFB's Last Result/Next Game blank until this migration).
export const V2_MIGRATED_LEAGUES = ['epl', 'cfb'];

// V2's team-lookup response is shaped { lookup: [...] } and its
// schedule responses are { schedule: [...] } — normalized here into
// the { teams: [...] } / { results: [...], events: [...] } shape V1
// used, so renderStats/renderForm/renderNext (js/live-data.js) don't
// need to change at all for the pilot. Field *names* inside each entry
// (strSport, strHomeTeam, intHomeScore, strTimestamp, etc.) matched
// V1's one-for-one when checked against real data — see Phase 1
// findings.
export async function fetchSportsDbV2Team(id){
  const v2 = await fetchJSON(`${DASHBOARD_WORKER_BASE}/sportsdb/team/${id}`);
  return v2 && v2.lookup ? { teams: v2.lookup } : null;
}

export async function fetchSportsDbV2Schedule(kind, id){
  const v2 = await fetchJSON(`${DASHBOARD_WORKER_BASE}/sportsdb/${kind}/${id}`);
  const list = (v2 && v2.schedule) || [];
  return { results: list, events: list };
}
