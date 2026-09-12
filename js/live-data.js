/* ============================================================
   Live data: fetch, cache, and render each team's stats/last
   result/next fixture, plus the team detail modal and the staggered
   background refresh loop that keeps it all current.
   ============================================================ */
import { TEAM_META, PRIOR_SEASON_DISPLAY_LEAGUES } from './data.js';
import { fetchJSON, ordinal, formatKickoff, formatUpdatedAt, teamBadgeHtml, lockBodyScroll, unlockBodyScroll } from './utils.js';
import { API_BASE, fetchRundownEventForTeam, isRundownEventLive, V2_MIGRATED_LEAGUES, UPCOMING_CHIP_LEAGUES, fetchSportsDbV2Team, fetchSportsDbV2Schedule } from './api.js';
import { fetchEplStandingsTable, findEspnEplRow } from './standings-epl.js';
import { fetchEspnTeamSchedule, fetchEspnScoreboard, findEspnScoreboardLine } from './espn.js';
import { findCfbRecord, findEspnCfbRow, fetchEspnCfbRecordsCached } from './standings-cfb.js';
import { findEspnNflRow, fetchEspnNflStandingsCached, nflDivisionLabel, fetchEspnNflDivisionStandingsCached } from './standings-nfl.js';
import { nbaRecordLabel, findEspnNbaRow, fetchEspnNbaStandingsCached, nbaDivisionLabel, fetchEspnNbaDivisionStandingsCached } from './standings-nba.js';
import { nhlRecordLabel, findEspnNhlRow, fetchEspnNhlStandingsCached, nhlDivisionLabel, fetchEspnNhlDivisionStandingsCached } from './standings-nhl.js';
import { mlbRecordLabel, findEspnMlbRow, fetchEspnMlbStandingsCached, mlbDivisionLabel, fetchEspnMlbDivisionStandingsCached } from './standings-mlb.js';
import { wnbaRecordLabel, findEspnWnbaRow, fetchEspnWnbaStandingsCached } from './standings-wnba.js';
import { trackerSectionHtml } from './league-facts.js';

// Every league whose Most Recent Result/Next Match comes from ESPN's
// team-schedule endpoint (js/espn.js's fetchEspnTeamSchedule) rather
// than TheSportsDB — see the "EPL/NBA/NHL/MLB/WNBA" branch in
// fetchTeamBundle below. Each entry's `ensureStandings` is that
// league's own fetchCached (called first so `findRow` can resolve this
// club's ESPN team id by name — ESPN's ids don't line up with
// TheSportsDB's sportsdbId), and `sportPath` is ESPN's own sport/league
// slug for the schedule URL.
const FLAT_SCHEDULE_LEAGUES = {
  epl: { sportPath: 'soccer/eng.1', ensureStandings: fetchEplStandingsTable, findRow: findEspnEplRow },
  nfl: { sportPath: 'football/nfl', ensureStandings: fetchEspnNflStandingsCached, findRow: findEspnNflRow },
  cfb: { sportPath: 'football/college-football', ensureStandings: fetchEspnCfbRecordsCached, findRow: findEspnCfbRow },
  nba: { sportPath: 'basketball/nba', ensureStandings: fetchEspnNbaStandingsCached, findRow: findEspnNbaRow },
  nhl: { sportPath: 'hockey/nhl', ensureStandings: fetchEspnNhlStandingsCached, findRow: findEspnNhlRow },
  mlb: { sportPath: 'baseball/mlb', ensureStandings: fetchEspnMlbStandingsCached, findRow: findEspnMlbRow },
  wnba: { sportPath: 'basketball/wnba', ensureStandings: fetchEspnWnbaStandingsCached, findRow: findEspnWnbaRow }
};

// Today's scoreboard for a league — one shared fetch per sportPath
// (mirrors rundownDayCache in js/api.js), not one per team, since every
// team in FLAT_SCHEDULE_LEAGUES sharing a sportPath reads the exact
// same response. This is what replaces TheRundown for live in-game
// state (score/clock while a game is actually in progress) across
// those 7 leagues — see fetchEspnScoreboard/findEspnScoreboardLine in
// js/espn.js. Short TTL since a live score can move by the second;
// same cadence TheRundown's own day-cache used.
const ESPN_SCOREBOARD_TTL_MS = 60 * 1000;
const espnScoreboardCache = {}; // sportPath -> { data: {events, season}, fetchedAt }

async function fetchEspnScoreboardCached(sportPath){
  const cached = espnScoreboardCache[sportPath];
  if(cached && (Date.now() - cached.fetchedAt) < ESPN_SCOREBOARD_TTL_MS) return cached.data;
  const data = await fetchEspnScoreboard(sportPath);
  espnScoreboardCache[sportPath] = { data, fetchedAt: Date.now() };
  return data;
}

const LIVE_DATA_CACHE_KEY = 'teamDashboardLiveDataCache';

export const liveDataCache = {}; // teamKey -> { info, last, next, table, fetchedAt }

// Mirrors liveDataCache to localStorage — one key per team — so a
// team's last-known result survives across browser sessions, rather
// than every fresh page load starting blank until that team's turn
// comes up in the staggered background refresh (see REFRESH_STEP_MS
// below), which can take up to ~15 minutes. This is a per-browser
// convenience cache, not shared state — every viewer still fetches
// their own fresh data on the same schedule as before; this only
// changes what shows while waiting for that.
//
// Written per-team rather than as one growing JSON blob under
// LIVE_DATA_CACHE_KEY (the old shape) so a single team's refresh tick
// only serializes and writes that team's own entry — with the roster
// headed toward ~225 teams (see LIVE_TEAM_KEYS below), rewriting one
// ever-larger blob on every ~14s tick would mean a bigger synchronous
// write each time, almost all of it for teams that didn't even change.
const LIVE_DATA_CACHE_PREFIX = 'teamDashboardLiveData:';

function saveTeamBundleToStorage(teamKey, bundle){
  try { localStorage.setItem(LIVE_DATA_CACHE_PREFIX + teamKey, JSON.stringify(bundle)); } catch (e){}
}

function setTeamBundle(teamKey, bundle){
  liveDataCache[teamKey] = bundle;
  saveTeamBundleToStorage(teamKey, bundle);
}

// One-time move off the old single-blob key: reads whatever's there,
// fans it out into the new per-team keys, then removes it — so this
// only ever runs once, the same "don't lose what's already saved"
// approach as migrateAchievementsToFacts (js/league-facts.js).
function migrateLegacyLiveDataCache(){
  try {
    const raw = localStorage.getItem(LIVE_DATA_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    for(const teamKey of Object.keys(parsed)){
      localStorage.setItem(LIVE_DATA_CACHE_PREFIX + teamKey, JSON.stringify(parsed[teamKey]));
    }
    localStorage.removeItem(LIVE_DATA_CACHE_KEY);
  } catch (e){}
}

// Called once at boot, before the first paint, so cached pills show
// immediately rather than blank. fetchedAt round-trips through
// JSON.stringify as an ISO string, so it's parsed back into a Date
// here — everything else in a bundle is plain JSON already.
export function loadLiveDataCache(){
  migrateLegacyLiveDataCache();
  try {
    for(let i = 0; i < localStorage.length; i++){
      const key = localStorage.key(i);
      if(!key || !key.startsWith(LIVE_DATA_CACHE_PREFIX)) continue;
      const teamKey = key.slice(LIVE_DATA_CACHE_PREFIX.length);
      const raw = localStorage.getItem(key);
      if(!raw) continue;
      const bundle = JSON.parse(raw);
      if(bundle && bundle.fetchedAt) bundle.fetchedAt = new Date(bundle.fetchedAt);
      liveDataCache[teamKey] = bundle;
    }
  } catch (e){}
}

// ---- Team info: a separate, much slower-refreshing cache ----
// Of the 3 SportsDB calls a team used to make every single refresh
// tick, "team info" (sport, founded year, stadium, colors, badge) is
// essentially static — it doesn't change mid-season, unlike a team's
// last result or next fixture. Pulling it out of the per-tick fetch
// and caching it for a full day (persisted, so a fresh page load
// doesn't even need to re-fetch it) cuts a third of the per-team call
// volume with no real freshness cost. Same TTL-cache shape as
// eplStandingsCache/rundownDayCache elsewhere.
// Legacy single-blob key, migrated away from below (see
// migrateLegacyLiveDataCache's twin above for why: one growing
// JSON blob rewritten on every fetch doesn't scale as the roster grows).
const TEAM_INFO_CACHE_LEGACY_KEY = 'teamDashboardTeamInfoCache';
const TEAM_INFO_CACHE_PREFIX = 'teamDashboardTeamInfo:';
const TEAM_INFO_TTL_MS = 24 * 60 * 60 * 1000;
const teamInfoCache = {}; // teamKey -> { info, fetchedAt }

function saveTeamInfoToStorage(teamKey, entry){
  try { localStorage.setItem(TEAM_INFO_CACHE_PREFIX + teamKey, JSON.stringify(entry)); } catch (e){}
}

function migrateLegacyTeamInfoCache(){
  try {
    const raw = localStorage.getItem(TEAM_INFO_CACHE_LEGACY_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    for(const teamKey of Object.keys(parsed)){
      localStorage.setItem(TEAM_INFO_CACHE_PREFIX + teamKey, JSON.stringify(parsed[teamKey]));
    }
    localStorage.removeItem(TEAM_INFO_CACHE_LEGACY_KEY);
  } catch (e){}
}

export function loadTeamInfoCache(){
  migrateLegacyTeamInfoCache();
  try {
    for(let i = 0; i < localStorage.length; i++){
      const key = localStorage.key(i);
      if(!key || !key.startsWith(TEAM_INFO_CACHE_PREFIX)) continue;
      const teamKey = key.slice(TEAM_INFO_CACHE_PREFIX.length);
      const raw = localStorage.getItem(key);
      if(raw) teamInfoCache[teamKey] = JSON.parse(raw);
    }
  } catch (e){}
}

async function fetchTeamInfoCached(teamKey, id, useV2){
  const cached = teamInfoCache[teamKey];
  if(cached && (Date.now() - cached.fetchedAt) < TEAM_INFO_TTL_MS) return cached.info;

  const info = useV2 ? await fetchSportsDbV2Team(id) : await fetchJSON(`${API_BASE}lookupteam.php?id=${id}`);
  const entry = { info, fetchedAt: Date.now() };
  teamInfoCache[teamKey] = entry;
  saveTeamInfoToStorage(teamKey, entry);
  return entry.info;
}

async function fetchTeamBundle(teamKey){
  const meta = TEAM_META[teamKey];
  if(!meta) return null;

  // EPL/NFL/CFB/NBA/NHL/MLB/WNBA: real schedule (past results + every
  // remaining fixture) from ESPN (js/espn.js) instead of TheSportsDB's
  // eventslast/eventsnext (V1) or schedule-previous/schedule-next
  // (V2) — see fetchEspnTeamSchedule for what that adds (real venue
  // names, TV broadcasts). Standings have to load first: ESPN's team
  // ids don't line up with TheSportsDB's sportsdbId (same issue
  // findEspnEplRow/findEspnNbaRow/etc already solve for the stat
  // strip), so this club's ESPN id is resolved by name through the
  // standings table rather than carried as its own TEAM_META field —
  // which also means this doesn't need meta.sportsdbId at all, unlike
  // the generic branch below: NBA/NHL/MLB/WNBA teams that were never
  // given a sportsdbId (every currently-drafted team but Josh's own —
  // real board-card records for them already came from this same
  // name-matching, see js/standings-flat.js) get a real modal schedule
  // here too, not just the "not hooked up" placeholder they got before
  // this was checked ahead of the sportsdbId gate. Only commits to this
  // path once that id actually resolves — a team whose row genuinely
  // never resolves falls through to the generic TheSportsDB/TheRundown
  // branch below instead of ending up with no data at all, same as
  // NDSU used to before it got its own ESPN row (see NDSU_ESPN_TEAM_ID
  // in js/standings-cfb.js).
  const flatSchedule = FLAT_SCHEDULE_LEAGUES[meta.leagueKey];
  if(flatSchedule){
    await flatSchedule.ensureStandings();
    const row = flatSchedule.findRow(meta);
    if(row){
      // No TheSportsDB "info" fetch here — every league on this path
      // has its own real-record branch in renderStats (findEspnEplRow,
      // findCfbRecord, etc.) that always renders first, so bundle.info
      // (TheSportsDB's generic Sport/Founded/Stadium bio) would never
      // actually reach the screen for a team that resolves this far.
      // Fetching it anyway was pure unused SportsDB traffic on every
      // refresh — cut once that stopped being needed for NDSU too (see
      // NDSU_ESPN_TEAM_ID in js/standings-cfb.js).
      const [espnSchedule, scoreboard] = await Promise.all([
        fetchEspnTeamSchedule(flatSchedule.sportPath, row.id),
        fetchEspnScoreboardCached(flatSchedule.sportPath)
      ]);
      const espnLive = findEspnScoreboardLine(scoreboard ? scoreboard.events : null, row.id);
      const espnSeason = scoreboard ? scoreboard.season : null;
      const bundle = { info: null, last: null, next: null, espnSchedule, espnLive, espnSeason, rundownTeamId: meta.rundownTeamId || null, fetchedAt: new Date() };
      setTeamBundle(teamKey, bundle);
      return bundle;
    }
  }

  if(!meta.sportsdbId && !meta.rundownTeamId) return null;

  if(meta.sportsdbId){
    const id = meta.sportsdbId;
    const useV2 = V2_MIGRATED_LEAGUES.includes(meta.leagueKey);

    // TheSportsDB-primary teams (the common case): everything comes from
    // TheSportsDB, optionally supplemented with TheRundown's in-game
    // state for leagues in RUNDOWN_SPORT_ID (see fetchRundownEventForTeam).
    // Team info is decoupled from this per-tick fetch — see
    // fetchTeamInfoCached — since it's the one piece of this bundle
    // that's effectively static.
    const [info, last, next, rundownEvent] = await Promise.all([
      fetchTeamInfoCached(teamKey, id, useV2),
      useV2 ? fetchSportsDbV2Schedule('schedule-previous', id) : fetchJSON(`${API_BASE}eventslast.php?id=${id}`),
      useV2 ? fetchSportsDbV2Schedule('schedule-next', id) : fetchJSON(`${API_BASE}eventsnext.php?id=${id}`),
      fetchRundownEventForTeam(meta)
    ]);

    const bundle = { info, last, next, rundownEvent, rundownTeamId: meta.rundownTeamId || null, fetchedAt: new Date() };
    setTeamBundle(teamKey, bundle);
    return bundle;
  }

  // Rundown-only teams (currently just College Basketball, which
  // TheSportsDB doesn't carry at all): TheRundown is the sole live
  // source. Scoped to today's slate only, not a multi-day lookahead —
  // see renderRowStatus/renderNext/renderForm for how that's rendered.
  const rundownEvent = await fetchRundownEventForTeam(meta);
  const bundle = { info: null, last: null, next: null, table: null, rundownEvent, rundownTeamId: meta.rundownTeamId, rundownOnly: true, fetchedAt: new Date() };
  setTeamBundle(teamKey, bundle);
  return bundle;
}

// Turns ESPN's solid zone hex (e.g. "#81D6AC") into a low-alpha rgba,
// matching the soft-tint badge look used everywhere else (--win-soft,
// --loss-soft, etc.) instead of a solid pastel fill with forced dark text.
function softZoneTint(hex, alpha){
  const h = hex.replace(/^#+/, '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ESPN's standard season-phase enum — confirmed against the core API's
// leagues/{league}/seasons/{year}/types listing (NFL: 1 Preseason 2026-
// 08-06→09-06, 2 Regular Season 09-06→2027-01-13, 3 Postseason →02-16,
// 4 Off Season →08-01) — mapped to the modal-head season badge below.
const ESPN_SEASON_TYPE = {
  1: { label: 'Pre-Season', cls: 'pre' },
  2: { label: 'In-Season', cls: 'in' },
  3: { label: 'Post-Season', cls: 'post' },
  4: { label: 'Season Complete', cls: 'complete' }
};

// EPL's ESPN season has no pre/post/off split at all — the core API
// lists exactly one continuous "types" entry for the whole Aug-May
// campaign, unlike NFL/NBA/etc's four. So instead of a real
// season.type, this reads the same schedule already fetched for the
// modal (bundle.espnSchedule) and infers phase from what's actually on
// it: nothing played and nothing left means the close season, nothing
// played yet but fixtures exist means it hasn't kicked off, and
// everything else (or a full but exhausted fixture list) is scored as
// either mid-season or wrapped up.
function eplSeasonStatus(bundle){
  const sched = bundle.espnSchedule;
  if(!sched) return null;
  const played = sched.recent && sched.recent.length > 0;
  const scheduled = sched.upcoming && sched.upcoming.length > 0;
  if(!played && !scheduled) return { label: 'Season Complete', cls: 'complete' };
  if(!played) return { label: 'Pre-Season', cls: 'pre' };
  if(!scheduled) return { label: 'Season Complete', cls: 'complete' };
  return { label: 'In-Season', cls: 'in' };
}

// What phase of its season this team's league is actually in right
// now — not just "do we have live data hooked up" (that's hasLive in
// openTeamModal, which only gates whether this badge's slot exists at
// all). Returns null when there's no reliable signal (college
// basketball has no ESPN wiring at all — see FLAT_SCHEDULE_LEAGUES —
// so its bundle carries neither espnSeason nor espnSchedule), in which
// case the badge stays hidden rather than guessing.
function seasonStatus(meta, bundle){
  if(meta.leagueKey === 'epl') return eplSeasonStatus(bundle);
  if(bundle.espnSeason && ESPN_SEASON_TYPE[bundle.espnSeason.type]) return ESPN_SEASON_TYPE[bundle.espnSeason.type];
  return null;
}

function renderSeasonBadge(meta, bundle){
  const el = document.getElementById('season-badge');
  if(!el) return;
  const status = seasonStatus(meta, bundle);
  el.style.display = status ? 'inline-block' : 'none';
  el.innerHTML = status ? `<span class="season-badge ${status.cls}">${status.label}</span>` : '';
}

export function renderStats(meta, bundle){
  const el = document.getElementById('live-stats');
  if(!el) return;

  // EPL: same ESPN standings source the Standings tab reads (see
  // findEspnEplRow/eplRecordLabel in js/standings-epl.js) — this used
  // to match on TheSportsDB's idTeam/sportsdbId; ESPN's team ids don't
  // line up with those, so this matches by club name instead, same as
  // everywhere else in standings-epl.js.
  if(meta.leagueKey === 'epl'){
    const row = findEspnEplRow(meta);
    if(row){
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${ordinal(row.rank)}</div><div class="lbl">Position</div></div>
        <div class="stat-cell"><div class="num">${row.points}</div><div class="lbl">Points</div></div>
        <div class="stat-cell"><div class="num">${row.wins}-${row.draws}-${row.losses}</div><div class="lbl">W-D-L</div></div>
      `;
      // Champions League/Europa League/Relegation — straight off ESPN's
      // own qualification-zone note, which TheSportsDB's table never
      // had at all. Sits in the modal head (see openTeamModal), not the
      // stat strip, so this only updates that one span rather than
      // re-rendering stats around it.
      const zoneEl = document.getElementById('zone-tag');
      if(zoneEl){
        // display toggled (not just emptied) so an inactive zone doesn't
        // still eat a flex gap slot in .modal-sub next to it.
        zoneEl.style.display = row.zone ? 'inline-block' : 'none';
        const zoneColor = row.zoneColor || '#94969E';
        zoneEl.innerHTML = row.zone
          ? `<span class="zone-tag" style="color:${zoneColor};background:${softZoneTint(zoneColor, 0.16)};">${row.zone}</span>`
          : '';
      }
      return;
    }
  }

  // CFB: findCfbRecord (js/standings-cfb.js) — ESPN's full FBS
  // standings first, falling back to TheRundown only for the one
  // drafted FCS team ESPN's standings don't cover — carries a real
  // record and AP Top 25 rank, more useful here than TheSportsDB's
  // generic Sport/Founded/Stadium bio fields.
  if(meta.leagueKey === 'cfb'){
    const rec = findCfbRecord(meta);
    if(rec && rec.wins !== null){
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${rec.wins}-${rec.losses}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num">${typeof rec.ranking === 'number' ? '#' + rec.ranking : 'NR'}</div><div class="lbl">AP Rank</div></div>
      `;
      return;
    }
  }

  // NFL: same ESPN standings source the Standings tab reads (see
  // findEspnNflRow/nflRecordLabel in js/standings-nfl.js) — this used
  // to read TheRundown's per-team division field instead, which could
  // (and did) drift from what the Standings tab showed once that moved
  // to ESPN. Division now comes from that same Standings-tab source too
  // (nflDivisionLabel/fetchEspnNflDivisionStandingsCached) — it didn't
  // exist when this modal was first built (ESPN's simple standings
  // endpoint has no division field at all; that heavier per-division
  // fetch came later), which is why Conference used to be the only
  // grouping shown here. fetchEspnNflDivisionStandingsCached is a no-op
  // if already fresh; kicked off here (not just from the Standings tab)
  // since this is often the first place in a session that needs it —
  // its own completion re-renders this modal if it's still open once
  // that heavier fetch resolves.
  if(meta.leagueKey === 'nfl'){
    const row = findEspnNflRow(meta);
    if(row){
      const recordLabel = `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`;
      fetchEspnNflDivisionStandingsCached();
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${recordLabel}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${row.conferenceAbbr || '—'}</div><div class="lbl">Conference</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${nflDivisionLabel(meta) || '—'}</div><div class="lbl">Division</div></div>
      `;
      return;
    }
  }

  // NBA/NHL/MLB/WNBA: same ESPN standings source the Standings tab
  // reads (js/standings-flat.js's createFlatStandingsBoard) — these 4
  // leagues had no real record source at all before ESPN, only the
  // generic Sport/Founded/Stadium bio fields below. Division (NBA/NHL/
  // MLB only — WNBA has no real divisions, see js/standings-wnba.js)
  // follows the same "kick off the heavier fetch here, its own
  // completion re-renders this modal" pattern as NFL's above.
  if(meta.leagueKey === 'nba'){
    const record = nbaRecordLabel(meta);
    if(record){
      const row = findEspnNbaRow(meta);
      fetchEspnNbaDivisionStandingsCached();
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${record}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${row.conferenceAbbr || '—'}</div><div class="lbl">Conference</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${nbaDivisionLabel(meta) || '—'}</div><div class="lbl">Division</div></div>
      `;
      return;
    }
  }
  if(meta.leagueKey === 'nhl'){
    const record = nhlRecordLabel(meta);
    if(record){
      const row = findEspnNhlRow(meta);
      fetchEspnNhlDivisionStandingsCached();
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${row.wins}-${row.losses}-${row.otLosses || 0}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num">${row.points}</div><div class="lbl">Points</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${row.conferenceAbbr || '—'}</div><div class="lbl">Conference</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${nhlDivisionLabel(meta) || '—'}</div><div class="lbl">Division</div></div>
      `;
      return;
    }
  }
  if(meta.leagueKey === 'mlb'){
    const record = mlbRecordLabel(meta);
    if(record){
      const row = findEspnMlbRow(meta);
      fetchEspnMlbDivisionStandingsCached();
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${record}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${row.conferenceAbbr || '—'}</div><div class="lbl">League</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${mlbDivisionLabel(meta) || '—'}</div><div class="lbl">Division</div></div>
      `;
      return;
    }
  }
  if(meta.leagueKey === 'wnba'){
    const record = wnbaRecordLabel(meta);
    if(record){
      const row = findEspnWnbaRow(meta);
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${record}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${row.conferenceAbbr || '—'}</div><div class="lbl">Conference</div></div>
      `;
      return;
    }
  }

  const team = bundle.info && bundle.info.teams && bundle.info.teams[0];
  if(team){
    el.innerHTML = `
      <div class="stat-cell"><div class="num">${team.strSport || '—'}</div><div class="lbl">Sport</div></div>
      <div class="stat-cell"><div class="num">${team.intFormedYear || '—'}</div><div class="lbl">Founded</div></div>
      <div class="stat-cell"><div class="num" style="font-size:14px;">${team.strStadium || '—'}</div><div class="lbl">Home</div></div>
    `;
    return;
  }

  el.innerHTML = bundle.rundownOnly
    ? `<div class="stat-cell" style="flex:1;"><div class="lbl">Team info isn't available from this data source</div></div>`
    : `<div class="stat-cell" style="flex:1;"><div class="lbl">Live stats unavailable right now</div></div>`;
}

// Last 5 results as a compact row of pills, oldest on the left ending
// with the most recent (matches recentEvents' own newest-first order,
// so this just reverses a slice of it) — the detailed line rendered
// below it always covers the rightmost/most recent one already.
function formStripHtml(recentEvents){
  const last5 = recentEvents.slice(0, 5).reverse();
  return `
    <div class="form-strip">
      ${last5.map(evt => {
        let cls = 'd', label = 'D';
        if(evt.ownScore > evt.oppScore){ cls = 'w'; label = 'W'; }
        else if(evt.ownScore < evt.oppScore){ cls = 'l'; label = 'L'; }
        const title = `${evt.isHome ? 'vs' : 'at'} ${evt.opponentName} · ${evt.ownScore}-${evt.oppScore}`;
        return `<div class="form-pill ${cls}" title="${title}">${label}</div>`;
      }).join('')}
    </div>
  `;
}

function renderForm(id, bundle){
  const el = document.getElementById('live-form');
  if(!el) return;

  const rStatus = bundle.rundownEvent && bundle.rundownEvent.score && bundle.rundownEvent.score.event_status;
  if(rStatus === 'STATUS_FINAL'){
    const line = rundownEventLine(bundle.rundownEvent, bundle.rundownTeamId);
    let result = 'd', label = 'D';
    if(line.own > line.opp){ result = 'w'; label = 'W'; }
    else if(line.own < line.opp){ result = 'l'; label = 'L'; }
    el.innerHTML = `
      <div class="form-item">
        <div class="form-pill ${result}">${label}</div>
        <div class="form-detail">
          <span class="opp">${line.opponentName}</span>
          <span class="meta">${line.isHome ? 'Home' : 'Away'}</span>
        </div>
        <div class="form-score">${line.own}–${line.opp}</div>
      </div>
    `;
    return;
  }

  // EPL: real schedule data from ESPN (js/espn.js) instead of
  // TheSportsDB's eventslast — see fetchEspnTeamSchedule. Adds a
  // "Form" strip (last 5 results) above the usual detailed line, and a
  // real venue name on that line — neither available from TheSportsDB.
  if(bundle.espnSchedule){
    const recent = bundle.espnSchedule.recent;
    const evt = recent && recent[0];
    if(!evt){
      el.innerHTML = `<div class="loading-note">No recent result found.</div>`;
      return;
    }
    let result = 'd', label = 'D';
    if(evt.ownScore > evt.oppScore){ result = 'w'; label = 'W'; }
    else if(evt.ownScore < evt.oppScore){ result = 'l'; label = 'L'; }
    el.innerHTML = `
      ${formStripHtml(recent)}
      <div class="form-item">
        <div class="form-pill ${result}">${label}</div>
        <div class="form-detail">
          <span class="opp">${evt.opponentName}</span>
          <span class="meta">${evt.isHome ? 'Home' : 'Away'}${evt.venueName ? ' · ' + evt.venueName : ''}</span>
        </div>
        <div class="form-score">${evt.ownScore}–${evt.oppScore}</div>
      </div>
    `;
    return;
  }

  const evt = bundle.last && bundle.last.results && bundle.last.results[0];
  if(!evt){
    el.innerHTML = bundle.rundownOnly
      ? `<div class="loading-note">No recent result — check back once the season's underway.</div>`
      : `<div class="loading-note">No recent result found.</div>`;
    return;
  }

  const isHome = String(evt.idHomeTeam) === String(id);
  const opponent = isHome ? evt.strAwayTeam : evt.strHomeTeam;
  const own = isHome ? evt.intHomeScore : evt.intAwayScore;
  const opp = isHome ? evt.intAwayScore : evt.intHomeScore;

  let result = 'd', label = 'D';
  if(own !== null && opp !== null && own !== undefined && opp !== undefined){
    if(parseInt(own, 10) > parseInt(opp, 10)){ result = 'w'; label = 'W'; }
    else if(parseInt(own, 10) < parseInt(opp, 10)){ result = 'l'; label = 'L'; }
  }

  el.innerHTML = `
    <div class="form-item">
      <div class="form-pill ${result}">${label}</div>
      <div class="form-detail">
        <span class="opp">${opponent || 'TBD'}</span>
        <span class="meta">${isHome ? 'Home' : 'Away'}${evt.dateEvent ? ' · ' + evt.dateEvent : ''}</span>
      </div>
      <div class="form-score">${own ?? '–'}–${opp ?? '–'}</div>
    </div>
  `;
}

// Shared by renderNext, renderForm and renderRowStatus: pulls this
// team's own score, the opponent's score/name, and a human
// clock/period label out of a TheRundown event, from that team's
// perspective — live or not; callers branch on event_status first.
function rundownEventLine(event, rundownTeamId){
  const s = event.score;
  const isHome = s.team_id_home === rundownTeamId;
  const own = isHome ? s.score_home : s.score_away;
  const opp = isHome ? s.score_away : s.score_home;
  const opponent = (event.teams || []).find(t => t.team_id !== rundownTeamId);
  const period = s.display_clock || s.event_status_detail || 'Live';
  return { isHome, own, opp, opponentName: (opponent && opponent.name) || 'TBD', period };
}

function renderNext(id, bundle){
  const el = document.getElementById('live-next');
  if(!el) return;

  // EPL/NFL/CFB/NBA/NHL/MLB/WNBA: live in-game state from ESPN's
  // scoreboard (js/espn.js) instead of TheRundown — see
  // fetchEspnScoreboardCached/findEspnScoreboardLine above. Checked
  // first since a game actually in progress takes priority over the
  // upcoming-fixture line the espnSchedule branch below would show.
  if(bundle.espnLive && bundle.espnLive.isLive){
    const line = bundle.espnLive;
    el.innerHTML = `
      <div class="nm-left">
        <div class="nm-teams">${line.isHome ? 'vs' : 'at'} ${line.opponentName}</div>
        <div class="nm-when"><span class="live-badge">LIVE</span> ${line.own}-${line.opp} · ${line.period}</div>
      </div>
    `;
    return;
  }

  const rEvt = bundle.rundownEvent;
  const rStatus = rEvt && rEvt.score && rEvt.score.event_status;

  if(isRundownEventLive(rEvt)){
    const line = rundownEventLine(rEvt, bundle.rundownTeamId);
    el.innerHTML = `
      <div class="nm-left">
        <div class="nm-teams">${line.isHome ? 'vs' : 'at'} ${line.opponentName}</div>
        <div class="nm-when"><span class="live-badge">LIVE</span> ${line.own}-${line.opp} · ${line.period}</div>
      </div>
    `;
    return;
  }

  // Rundown-only teams have no TheSportsDB eventsnext to fall back to,
  // so a scheduled-for-today game (found via fetchRundownEventForTeam,
  // which only checks today — see fetchTeamBundle) is shown here too.
  if(rStatus === 'STATUS_SCHEDULED'){
    const line = rundownEventLine(rEvt, bundle.rundownTeamId);
    el.innerHTML = `
      <div class="nm-left">
        <div class="nm-teams">${line.isHome ? 'vs' : 'at'} ${line.opponentName}</div>
        <div class="nm-when">${formatKickoff(rEvt.event_date)}${line.isHome ? ' · Home' : ' · Away'}</div>
      </div>
    `;
    return;
  }

  // EPL: real schedule data from ESPN (js/espn.js) instead of
  // TheSportsDB's eventsnext — see fetchEspnTeamSchedule. Adds the
  // real venue and TV broadcast, neither available from TheSportsDB.
  if(bundle.espnSchedule){
    const evt = bundle.espnSchedule.upcoming && bundle.espnSchedule.upcoming[0];
    if(!evt){
      el.innerHTML = `<div class="loading-note">No upcoming match scheduled yet.</div>`;
      return;
    }
    const metaLine = [evt.isHome ? 'Home' : 'Away', evt.venueName, evt.broadcast].filter(Boolean).join(' · ');
    el.innerHTML = `
      <div class="nm-left">
        <div class="nm-teams">${evt.isHome ? 'vs' : 'at'} ${evt.opponentName}</div>
        <div class="nm-when">${formatKickoff(evt.date)}</div>
        <div class="nm-venue">${metaLine}</div>
      </div>
    `;
    return;
  }

  const evt = bundle.next && bundle.next.events && bundle.next.events[0];
  if(!evt){
    el.innerHTML = bundle.rundownOnly
      ? `<div class="loading-note">No game scheduled today — check back once the season's underway.</div>`
      : `<div class="loading-note">No upcoming match scheduled yet.</div>`;
    return;
  }

  const isHome = String(evt.idHomeTeam) === String(id);
  const opponent = isHome ? evt.strAwayTeam : evt.strHomeTeam;

  el.innerHTML = `
    <div class="nm-left">
      <div class="nm-teams">${isHome ? 'vs' : 'at'} ${opponent || 'TBD'}</div>
      <div class="nm-when">${formatKickoff(evt.strTimestamp)}${isHome ? ' · Home' : ' · Away'}</div>
    </div>
  `;
}

function renderUpdatedAt(bundle){
  const el = document.getElementById('live-updated');
  if(!el || !bundle || !bundle.fetchedAt) return;
  el.textContent = `Last updated: ${formatUpdatedAt(bundle.fetchedAt)}`;
}

// Compact date label for the "next match" row-status pill — "Today
// 6:00 PM" for a game today, otherwise a short weekday + time
// ("Sat 11:30 AM") since there's no room in the pill for a full date.
function formatChipUpcoming(d){
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if(d.toDateString() === new Date().toDateString()) return 'Today ' + time;
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + time;
}

// Board-row pill: reuses whatever the modal fetch already pulled
// (last result / next fixture) rather than fetching anything extra,
// so it stays inside the same 30 req/min budget described in js/api.js.
export function renderRowStatus(teamKey, bundle){
  const el = document.getElementById('row-status-' + teamKey);
  if(!el) return;
  const meta = TEAM_META[teamKey];
  const id = meta.sportsdbId;

  // EPL/NFL/CFB/NBA/NHL/MLB/WNBA: live in-game state from ESPN's
  // scoreboard instead of TheRundown — see findEspnScoreboardLine in
  // js/espn.js. Same priority-over-everything-else idea as renderNext.
  if(bundle.espnLive && bundle.espnLive.isLive){
    el.textContent = `LIVE ${bundle.espnLive.own}-${bundle.espnLive.opp}`;
    el.className = 'row-status live';
    return;
  }

  const rEvt = bundle.rundownEvent;
  const rStatus = rEvt && rEvt.score && rEvt.score.event_status;

  if(isRundownEventLive(rEvt)){
    const line = rundownEventLine(rEvt, bundle.rundownTeamId);
    el.textContent = `LIVE ${line.own}-${line.opp}`;
    el.className = 'row-status live';
    return;
  }

  // Rundown-only teams (no TheSportsDB fallback) get their today's-game
  // result/fixture straight from the same event checked for live state.
  if(bundle.rundownOnly && rStatus === 'STATUS_FINAL'){
    const line = rundownEventLine(rEvt, bundle.rundownTeamId);
    let cls = 'd', label = 'D';
    if(line.own > line.opp){ cls = 'w'; label = 'W'; } else if(line.own < line.opp){ cls = 'l'; label = 'L'; }
    el.textContent = `${label} ${line.own}-${line.opp}`;
    el.className = 'row-status ' + cls;
    return;
  }
  if(bundle.rundownOnly && rStatus === 'STATUS_SCHEDULED' && rEvt.event_date){
    const d = new Date(rEvt.event_date);
    if(!isNaN(d.getTime())){
      el.textContent = formatChipUpcoming(d);
      el.className = 'row-status next';
      return;
    }
  }

  // CFB/EPL/NFL show the next match regardless of when it falls, rather
  // than only for today's game — see UPCOMING_CHIP_LEAGUES in js/api.js.
  // Every other league keeps "today's game, else last result", since a
  // nightly slate makes "next match" far less interesting than a look
  // back at how last night went.
  const showsUpcoming = UPCOMING_CHIP_LEAGUES.includes(meta.leagueKey);

  // EPL/NBA/NHL/MLB/WNBA: real schedule data from ESPN (js/espn.js)
  // instead of TheSportsDB's eventsnext — see fetchEspnTeamSchedule.
  // Still respects showsUpcoming above: EPL always shows its next
  // match, but NBA/NHL/MLB/WNBA keep the nightly-slate "today's game,
  // else last result" behavior they had on TheSportsDB, just sourced
  // from ESPN now.
  if(bundle.espnSchedule){
    const nextEvt = bundle.espnSchedule.upcoming && bundle.espnSchedule.upcoming[0];
    if(nextEvt){
      const d = new Date(nextEvt.date);
      if(!isNaN(d.getTime()) && (showsUpcoming || d.toDateString() === new Date().toDateString())){
        el.textContent = formatChipUpcoming(d);
        el.className = 'row-status next';
        return;
      }
    }
    if(!showsUpcoming){
      const lastEvt = bundle.espnSchedule.recent && bundle.espnSchedule.recent[0];
      if(lastEvt && lastEvt.ownScore !== null && lastEvt.oppScore !== null){
        let cls = 'd', label = 'D';
        if(lastEvt.ownScore > lastEvt.oppScore){ cls = 'w'; label = 'W'; }
        else if(lastEvt.ownScore < lastEvt.oppScore){ cls = 'l'; label = 'L'; }
        el.textContent = `${label} ${lastEvt.ownScore}-${lastEvt.oppScore}`;
        el.className = 'row-status ' + cls;
        return;
      }
    }
    el.textContent = '';
    el.className = 'row-status';
    return;
  }

  const nextEvt = bundle.next && bundle.next.events && bundle.next.events[0];
  if(nextEvt && nextEvt.strTimestamp){
    const d = new Date(nextEvt.strTimestamp.includes('Z') ? nextEvt.strTimestamp : nextEvt.strTimestamp + 'Z');
    if(!isNaN(d.getTime()) && (showsUpcoming || d.toDateString() === new Date().toDateString())){
      el.textContent = formatChipUpcoming(d);
      el.className = 'row-status next';
      return;
    }
  }

  if(!showsUpcoming){
    const lastEvt = bundle.last && bundle.last.results && bundle.last.results[0];
    if(lastEvt){
      const isHome = String(lastEvt.idHomeTeam) === String(id);
      const own = isHome ? lastEvt.intHomeScore : lastEvt.intAwayScore;
      const opp = isHome ? lastEvt.intAwayScore : lastEvt.intHomeScore;
      if(own !== null && opp !== null && own !== undefined && opp !== undefined){
        const ownN = parseInt(own, 10), oppN = parseInt(opp, 10);
        let cls = 'd', label = 'D';
        if(ownN > oppN){ cls = 'w'; label = 'W'; } else if(ownN < oppN){ cls = 'l'; label = 'L'; }
        el.textContent = `${label} ${ownN}-${oppN}`;
        el.className = 'row-status ' + cls;
        return;
      }
    }
  }

  el.textContent = '';
  el.className = 'row-status';
}

export function renderLiveBundle(teamKey, bundle){
  const meta = TEAM_META[teamKey];
  if(!meta || !bundle) return;
  renderStats(meta, bundle);
  renderSeasonBadge(meta, bundle);
  renderForm(meta.sportsdbId, bundle);
  renderNext(meta.sportsdbId, bundle);
  renderUpdatedAt(bundle);
}

async function openLiveTeam(teamKey){
  const bundle = await fetchTeamBundle(teamKey);
  if(bundle) renderRowStatus(teamKey, bundle);
  // If the modal moved on to a different team while this was loading, bail.
  if(document.getElementById('modal-content').dataset.activeTeam !== teamKey) return;

  if(bundle){
    renderLiveBundle(teamKey, bundle);
  } else {
    const el = document.getElementById('live-form');
    if(el) el.innerHTML = `<div class="loading-note">Unable to load live data right now — try again in a moment.</div>`;
  }
}

export function openTeamModal(teamKey){
  const meta = TEAM_META[teamKey];
  if(!meta) return;

  document.getElementById('modal-overlay').classList.add('open');
  lockBodyScroll();

  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = teamKey;
  modalContent.dataset.activeLeagueResults = '';

  // A team also has live data if its league is in FLAT_SCHEDULE_LEAGUES
  // (see fetchTeamBundle) — that path matches by name/nickname, not
  // sportsdbId, so it covers NBA/NHL/MLB/WNBA teams that were never
  // given a sportsdbId too (every currently-drafted team but Josh's
  // own), not just the ones with real TheSportsDB/TheRundown ids.
  const hasLive = !!meta.sportsdbId || !!meta.rundownTeamId || !!FLAT_SCHEDULE_LEAGUES[meta.leagueKey];
  const cached = hasLive ? liveDataCache[teamKey] : null;
  const tracker = trackerSectionHtml(teamKey);
  // MLB/WNBA: the stat strip and results below are ESPN's real, live
  // '26 data — still worth showing — but this team's drafted record
  // doesn't start scoring until the '27 season actually begins. See
  // PRIOR_SEASON_DISPLAY_LEAGUES in js/data.js.
  const priorSeasonNoteHtml = PRIOR_SEASON_DISPLAY_LEAGUES.includes(meta.leagueKey)
    ? `<div class="prior-season-note">Showing the '26 season, still in progress — this record won't count towards drafted team point totals until the '27 season.</div>`
    : '';

  modalContent.innerHTML = `
    <div class="modal-accent" style="background:${meta.accent};"></div>
    <div class="modal-head">
      ${teamBadgeHtml(meta)}
      <div>
        <h2>${meta.name}</h2>
        <div class="modal-sub">${meta.sub}${hasLive ? ' <span id="season-badge" style="display:none;"></span>' : ''}${meta.leagueKey === 'epl' ? '<span id="zone-tag" style="display:none;"></span>' : ''}</div>
      </div>
      <button class="modal-close" onclick="closeTeamModal()">&times;</button>
    </div>
    ${hasLive ? `
      <div class="stat-strip" id="live-stats">${cached ? '' : '<div class="stat-cell" style="flex:1;"><div class="lbl">Loading…</div></div>'}</div>
      <div class="modal-body">
        ${priorSeasonNoteHtml}
        <div class="modal-section-title">${meta.recentLabel || 'Most Recent Result'}</div>
        <div class="form-list" id="live-form">${cached ? '' : '<div class="loading-note">Loading…</div>'}</div>
        <div class="modal-section-title">Next Match</div>
        <div class="next-match" id="live-next">${cached ? '' : '<div class="loading-note">Loading…</div>'}</div>
        <div class="updated-note" id="live-updated"></div>
        <div id="tracker-section">${tracker}</div>
      </div>
    ` : `
      <div class="modal-body">
        <div class="no-live-note">Live results for ${meta.name} aren't hooked up yet — showing placeholder space here for now.</div>
        <div id="tracker-section">${tracker}</div>
      </div>
    `}
  `;

  if(hasLive){
    if(cached) renderLiveBundle(teamKey, cached);
    else openLiveTeam(teamKey);
  }
}
window.openTeamModal = openTeamModal;

export function closeTeamModal(){
  document.getElementById('modal-overlay').classList.remove('open');
  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = '';
  modalContent.dataset.activeLeagueResults = '';
  unlockBodyScroll();
}
window.closeTeamModal = closeTeamModal;

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') closeTeamModal();
});

/* ---- Staggered background refresh ----
   Refreshing every live team at once would burst way too many
   requests into a single second. Instead we refresh one team at a
   time on a rotating schedule, spread evenly across a full cycle, so
   sending is smoothed out to a handful of requests per minute rather
   than a spike. Every tick also paints that team's board-row pill
   (last result / today's fixture) from the same fetch — no extra
   requests for that. If a team's modal happens to be open when its
   turn comes up, it updates live and the "Last updated" time ticks
   forward right in front of you.

   The cycle length (how often any given team refreshes) is dynamic,
   not a fixed number — it's derived from how many teams are actually
   live and TheSportsDB's premium rate limit, so it stays safe as more
   leagues get wired up over time instead of needing to be manually
   retuned:
     - Each tick costs SPORTSDB_CALLS_PER_TEAM_TICK calls (last result
       + next fixture — team info is on its own day-long cache, see
       fetchTeamInfoCached, and standings are a shared 15-min cache,
       see fetchEplStandingsTable, so neither adds meaningfully here).
     - We budget up to SPORTSDB_RATE_BUDGET_PER_MIN of the real
       100/min premium ceiling for this steady loop, leaving the rest
       as headroom for those occasional extra calls.
     - The cycle never goes faster than MIN_REFRESH_CYCLE_MS even if
       the budget would allow it — there's no real benefit to
       refreshing scores more often than that for a casual dashboard.
   At today's team count this comes out to the 5-minute floor with
   plenty of budget to spare; the formula only stretches the cycle out
   once there are enough teams that 5 minutes would actually risk the
   rate limit — worked out around 225 teams at 2 calls/tick, comfortably
   past even a fully-wired 210-team roster. */
const SPORTSDB_CALLS_PER_TEAM_TICK = 2;
const SPORTSDB_RATE_BUDGET_PER_MIN = 90;
const MIN_REFRESH_CYCLE_MS = 5 * 60 * 1000;

const LIVE_TEAM_KEYS = Object.keys(TEAM_META).filter(k => TEAM_META[k].sportsdbId || TEAM_META[k].rundownTeamId);
const REFRESH_CYCLE_MS = Math.max(
  MIN_REFRESH_CYCLE_MS,
  (LIVE_TEAM_KEYS.length * SPORTSDB_CALLS_PER_TEAM_TICK / SPORTSDB_RATE_BUDGET_PER_MIN) * 60 * 1000
);
export const REFRESH_STEP_MS = LIVE_TEAM_KEYS.length ? REFRESH_CYCLE_MS / LIVE_TEAM_KEYS.length : REFRESH_CYCLE_MS;
let refreshCursor = 0;

export async function backgroundRefreshTick(){
  if(LIVE_TEAM_KEYS.length === 0) return;
  const teamKey = LIVE_TEAM_KEYS[refreshCursor % LIVE_TEAM_KEYS.length];
  refreshCursor++;

  const bundle = await fetchTeamBundle(teamKey);
  if(!bundle) return;
  renderRowStatus(teamKey, bundle);
  if(document.getElementById('modal-content').dataset.activeTeam === teamKey){
    renderLiveBundle(teamKey, bundle);
  }
}
