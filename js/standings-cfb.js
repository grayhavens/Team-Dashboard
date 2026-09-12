/* ============================================================
   CFB Standings: the real AP/CFP-style Top 25, plus each drafter's
   combined win percentage across their 3 CFB teams.
   Unlike EPL, TheSportsDB has no real standings data for college
   football — it lumps every team under one umbrella "NCAA Division 1"
   league with no conference breakdown, and that league's table endpoint
   returns genuinely empty (confirmed 2026-09-10, see the migration
   plan). So there's no "League" table view possible here, only "Person".

   Both the AP Top 25 (computeCfbRankingTable/renderCfbRankingRow) and
   full-roster win-loss records (findCfbRecord — the board card, the
   team modal stat strip, and the "Person" combined-win% view) read
   ESPN's hidden API (js/espn.js) now, not TheRundown — see
   docs/espn-migration-plan.md's Phase 2 (rankings) and the CFB phase
   further down that doc (records). Why: TheRundown's daily data-point
   budget is shared across all 8 leagues and can (did, on 2026-09-11)
   run out entirely, taking every CFB view down along with everything
   else on it; ESPN's endpoints have no key and no observed limit, and
   are CORS-open, so they're fetched directly here — no worker proxy
   needed, unlike TheRundown below.

   TheRundown's per-sport team list (cfbRecordsCache) — the same
   endpoint already used to help map rundownTeamId in js/data.js —
   still backs exactly one case: findCfbRecord falls back to it for a
   drafted CFB team ESPN's FBS-only standings doesn't cover (NDSU, an
   FCS program). Every other CFB team resolves through ESPN.
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { fetchJSON, teamBadgeHtml, abbrFromName } from './utils.js';
import { DASHBOARD_WORKER_BASE, RUNDOWN_SPORT_ID } from './api.js';
import { fetchEspnCfbRankings, fetchEspnCfbFullStandings } from './espn.js';
import { renderStandings } from './board.js';
import { liveDataCache, renderStats } from './live-data.js';

const CFB_RECORDS_CACHE_KEY = 'teamDashboardCfbRecordsCache';
// A team's record only changes after that team's own game (at most a
// couple of times a week), far slower than EPL's continuous slate — no
// need for EPL's 15min cadence here. Matches the worker's own
// CACHE_TTL_SECONDS.rundownTeams so both layers agree on freshness.
const CFB_RECORDS_TTL_MS = 60 * 60 * 1000;
export const cfbRecordsCache = { byTeamId: null, error: false, loading: false, fetchedAt: null };
let cfbRecordsPromise = null;

export function cfbRecordsIsFresh(){
  return !!cfbRecordsCache.byTeamId && !!cfbRecordsCache.fetchedAt && (Date.now() - cfbRecordsCache.fetchedAt) < CFB_RECORDS_TTL_MS;
}

function saveCfbRecordsCache(){
  try { localStorage.setItem(CFB_RECORDS_CACHE_KEY, JSON.stringify(cfbRecordsCache)); } catch (e){}
}

export function loadCfbRecordsCache(){
  try {
    const raw = localStorage.getItem(CFB_RECORDS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.byTeamId){
      cfbRecordsCache.byTeamId = parsed.byTeamId;
      cfbRecordsCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

// "10-7" -> {wins:10, losses:7}. Matches a leading W-L prefix rather
// than requiring an exact shape, in case TheRundown ever appends
// something after it — harmless either way since college football
// doesn't have ties.
export function parseWinLossRecord(record){
  const m = /^(\d+)-(\d+)/.exec(record || '');
  return m ? { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10) } : null;
}

export function fetchCfbRecords(){
  if(cfbRecordsCache.loading) return cfbRecordsPromise;
  if(cfbRecordsIsFresh()) return Promise.resolve();
  const sportId = RUNDOWN_SPORT_ID.cfb;
  if(!DASHBOARD_WORKER_BASE || !sportId) return Promise.resolve();

  cfbRecordsCache.loading = true;
  cfbRecordsPromise = (async () => {
    const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/teams/${sportId}`);
    cfbRecordsCache.loading = false;
    const teams = data && data.teams;
    if(teams && teams.length){
      const byTeamId = {};
      teams.forEach(t => { byTeamId[t.team_id] = t; });
      cfbRecordsCache.byTeamId = byTeamId;
      cfbRecordsCache.error = false;
      cfbRecordsCache.fetchedAt = Date.now();
      saveCfbRecordsCache();
    } else if(!cfbRecordsCache.byTeamId){
      // Only flag "no data" if we never had a table to fall back on —
      // same "don't blank out a good cache on a transient miss" rule
      // fetchEplStandingsTable follows in js/standings-epl.js.
      cfbRecordsCache.error = true;
    }
    renderStandings();
    renderAllCfbCardRecords();

    // If a CFB team's modal happens to be open already (its stats
    // cell rendered before this fetch resolved), refresh it now
    // rather than leaving the fallback bio stats up until reopened.
    const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
    const activeMeta = activeTeam && TEAM_META[activeTeam];
    if(activeMeta && activeMeta.leagueKey === 'cfb'){
      renderStats(activeMeta, liveDataCache[activeTeam] || {});
    }
  })();
  return cfbRecordsPromise;
}

// Record (and AP rank, if any) shown on each CFB team's board row —
// reads findCfbRecord below (ESPN-first, TheRundown fallback for the
// one FCS team ESPN's FBS-only standings doesn't cover), just painted
// onto the per-team span rather than re-rendering the whole board (see
// renderRowStatus in js/live-data.js for the same targeted-update
// pattern).
export function cfbRecordLabel(meta){
  const rec = findCfbRecord(meta);
  if(!rec || rec.wins === null) return '';
  const record = `${rec.wins}-${rec.losses}`;
  return typeof rec.ranking === 'number' ? `#${rec.ranking} &middot; ${record}` : record;
}

export function renderCfbCardRecord(teamKey){
  const el = document.getElementById('cfb-record-' + teamKey);
  if(!el) return;
  const label = cfbRecordLabel(TEAM_META[teamKey]);
  el.innerHTML = label ? ` &middot; ${label}` : '';
}

export function renderAllCfbCardRecords(){
  LEAGUES.find(l => l.key === 'cfb').teams.forEach(renderCfbCardRecord);
}

// ---- AP Top 25 (ESPN-sourced — see the file header comment) ----

const ESPN_CFB_RANKINGS_CACHE_KEY = 'teamDashboardEspnCfbRankingsCache';
// The AP poll only moves once a week (after Saturday's games), so this
// could be much longer than an hour — matched to CFB_RECORDS_TTL_MS
// below anyway, since "how fresh does this need to be" mattering less
// than "keep every cache in this file on one predictable rhythm".
const ESPN_CFB_RANKINGS_TTL_MS = 60 * 60 * 1000;
export const espnCfbRankingsCache = { ranks: null, error: false, loading: false, fetchedAt: null };
let espnCfbRankingsPromise = null;

function espnCfbRankingsIsFresh(){
  return !!espnCfbRankingsCache.ranks && !!espnCfbRankingsCache.fetchedAt && (Date.now() - espnCfbRankingsCache.fetchedAt) < ESPN_CFB_RANKINGS_TTL_MS;
}

function saveEspnCfbRankingsCache(){
  try { localStorage.setItem(ESPN_CFB_RANKINGS_CACHE_KEY, JSON.stringify(espnCfbRankingsCache)); } catch (e){}
}

export function loadEspnCfbRankingsCache(){
  try {
    const raw = localStorage.getItem(ESPN_CFB_RANKINGS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.ranks){
      espnCfbRankingsCache.ranks = parsed.ranks;
      espnCfbRankingsCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

export function fetchEspnCfbRankingsCached(){
  if(espnCfbRankingsCache.loading) return espnCfbRankingsPromise;
  if(espnCfbRankingsIsFresh()) return Promise.resolve();

  espnCfbRankingsCache.loading = true;
  espnCfbRankingsPromise = (async () => {
    const ranks = await fetchEspnCfbRankings();
    espnCfbRankingsCache.loading = false;
    if(ranks && ranks.length){
      espnCfbRankingsCache.ranks = ranks;
      espnCfbRankingsCache.error = false;
      espnCfbRankingsCache.fetchedAt = Date.now();
      saveEspnCfbRankingsCache();
    } else if(!espnCfbRankingsCache.ranks){
      // Same "don't blank out a good cache on a transient miss" rule as
      // cfbRecordsCache/fetchEplStandingsTable.
      espnCfbRankingsCache.error = true;
    }
    renderStandings();
  })();
  return espnCfbRankingsPromise;
}

// A ranked team's ESPN "location" (e.g. "Indiana") is compared against
// this app's own TEAM_META[...].name (e.g. "IU") to find a drafted
// match — most are verbatim-identical (see docs/espn-migration-plan.md's
// Pilot Results), but a handful aren't, so those get a manual override
// here rather than a fuzzier auto-match that could mis-pair two
// different schools.
const CFB_ESPN_NAME_OVERRIDES = {
  'Indiana': 'IU'
};

function normalizeTeamName(s){
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findCfbTeamKeyByEspnLocation(location){
  const wanted = normalizeTeamName(CFB_ESPN_NAME_OVERRIDES[location] || location);
  const teams = LEAGUES.find(l => l.key === 'cfb').teams;
  return teams.find(teamKey => normalizeTeamName(TEAM_META[teamKey].name) === wanted) || null;
}

// ---- Full-roster records (ESPN-sourced, replacing TheRundown for the
// 29 of 30 drafted CFB teams that are FBS — see the file header
// comment and findCfbRecord below) ----

const ESPN_CFB_RECORDS_CACHE_KEY = 'teamDashboardEspnCfbRecordsCache';
// Same hourly cadence as the AP rankings cache above — a team's record
// only changes after its own game, but there's no reason to let this
// one go stale longer just because it's a bigger payload (124 teams).
const ESPN_CFB_RECORDS_TTL_MS = 60 * 60 * 1000;
export const espnCfbRecordsCache = { rows: null, error: false, loading: false, fetchedAt: null };
let espnCfbRecordsPromise = null;

function espnCfbRecordsIsFresh(){
  return !!espnCfbRecordsCache.rows && !!espnCfbRecordsCache.fetchedAt && (Date.now() - espnCfbRecordsCache.fetchedAt) < ESPN_CFB_RECORDS_TTL_MS;
}

function saveEspnCfbRecordsCache(){
  try { localStorage.setItem(ESPN_CFB_RECORDS_CACHE_KEY, JSON.stringify(espnCfbRecordsCache)); } catch (e){}
}

export function loadEspnCfbRecordsCache(){
  try {
    const raw = localStorage.getItem(ESPN_CFB_RECORDS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.rows){
      espnCfbRecordsCache.rows = parsed.rows;
      espnCfbRecordsCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

export function fetchEspnCfbRecordsCached(){
  if(espnCfbRecordsCache.loading) return espnCfbRecordsPromise;
  if(espnCfbRecordsIsFresh()) return Promise.resolve();

  espnCfbRecordsCache.loading = true;
  espnCfbRecordsPromise = (async () => {
    const rows = await fetchEspnCfbFullStandings();
    espnCfbRecordsCache.loading = false;
    if(rows && rows.length){
      espnCfbRecordsCache.rows = rows;
      espnCfbRecordsCache.error = false;
      espnCfbRecordsCache.fetchedAt = Date.now();
      saveEspnCfbRecordsCache();
    } else if(!espnCfbRecordsCache.rows){
      // Same "don't blank out a good cache on a transient miss" rule as
      // cfbRecordsCache above.
      espnCfbRecordsCache.error = true;
    }
    renderStandings();
    renderAllCfbCardRecords();
    const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
    const activeMeta = activeTeam && TEAM_META[activeTeam];
    if(activeMeta && activeMeta.leagueKey === 'cfb'){
      renderStats(activeMeta, liveDataCache[activeTeam] || {});
    }
  })();
  return espnCfbRecordsPromise;
}

// Reverse direction of findCfbTeamKeyByEspnLocation — given a drafted
// team's own meta, find its row in the ESPN full-standings cache. The
// override table is checked both ways since a drafted team's own name
// (e.g. "IU") is the override's *output*, not its key ("Indiana").
// Exported for js/live-data.js too — it's also how fetchTeamBundle
// resolves this team's ESPN id for the schedule fetch (a null return,
// e.g. for NDSU, means that team falls back to the generic TheSportsDB
// schedule branch there instead of getting no schedule at all).
export function findEspnCfbRow(meta){
  const rows = espnCfbRecordsCache.rows;
  if(!rows) return null;
  const reverseOverride = Object.keys(CFB_ESPN_NAME_OVERRIDES).find(loc => CFB_ESPN_NAME_OVERRIDES[loc] === meta.name);
  const wanted = normalizeTeamName(reverseOverride || meta.name);
  return rows.find(row => normalizeTeamName(row.location) === wanted) || null;
}

// The real win-loss record (and AP Top 25 rank, if any) for a drafted
// CFB team — ESPN's full FBS standings first, falling back to
// TheRundown's cfbRecordsCache only when ESPN has no row at all, which
// today means exactly one drafted team: NDSU, an FCS program outside
// ESPN's FBS-only standings endpoint. Every other CFB team resolves
// through ESPN, off TheRundown's shared daily quota entirely.
export function findCfbRecord(meta){
  const espnRow = findEspnCfbRow(meta);
  if(espnRow){
    const rankRow = (espnCfbRankingsCache.ranks || []).find(r => normalizeTeamName(r.location) === normalizeTeamName(espnRow.location));
    return { wins: espnRow.wins, losses: espnRow.losses, ranking: rankRow ? rankRow.rank : null };
  }
  const rec = meta.rundownTeamId ? (cfbRecordsCache.byTeamId || {})[meta.rundownTeamId] : null;
  if(rec && rec.record){
    const parsed = parseWinLossRecord(rec.record);
    return {
      wins: parsed ? parsed.wins : null,
      losses: parsed ? parsed.losses : null,
      ranking: typeof rec.ranking === 'number' ? rec.ranking : null
    };
  }
  return null;
}

// ranks is already sorted 1-25 by ESPN — nothing left to compute here,
// this just exists so board.js doesn't need to know the cache's shape.
export function computeCfbRankingTable(){
  return espnCfbRankingsCache.ranks || [];
}

export function renderCfbRankingRow(rank){
  const teamKey = findCfbTeamKeyByEspnLocation(rank.location);
  // A ranked-but-undrafted team has no TEAM_META entry (so no SportsDB
  // badge), but ESPN's own logoUrl covers that — same real-crest
  // treatment drafted teams get, teamBadgeHtml's onerror handler falls
  // back to the plain monogram below if it ever fails to load.
  // School name only ("Alabama"), not the full "Alabama Crimson Tide" —
  // keeps undrafted rows consistent with how every drafted CFB team's
  // own TEAM_META.name is styled (school-only) across this app.
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: rank.location || rank.teamName,
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: abbrFromName(rank.location || rank.teamName),
    badgeUrl: rank.logoUrl || null
  };
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';

  return `
    <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
      <div class="standings-rank">${rank.rank}</div>
      ${teamBadgeHtml(meta)}
      <div class="team-main">
        <div class="team-name">${meta.name}</div>
        <div class="team-sub">${rank.record || ''}</div>
      </div>
      ${draftedByHtml}
    </div>
  `;
}

// Toggle between the real national Top 25 and each drafter's combined
// record — same idea as eplStandingsMode in js/standings-epl.js.
// Defaults to "ranking" since that's the real external data, matching
// EPL's "table" default.
export let cfbStandingsMode = 'ranking';

export function setCfbStandingsMode(mode){
  cfbStandingsMode = mode;
  renderStandings();
}
window.setCfbStandingsMode = setCfbStandingsMode;

export function cfbStandingsToggleHtml(){
  return `
    <div class="standings-toggle">
      <button class="toggle-btn ${cfbStandingsMode === 'ranking' ? 'active' : ''}" onclick="setCfbStandingsMode('ranking')">AP Top 25</button>
      <button class="toggle-btn ${cfbStandingsMode === 'byDrafter' ? 'active' : ''}" onclick="setCfbStandingsMode('byDrafter')">Person</button>
    </div>
  `;
}

// Combined win percentage across each drafter's 3 CFB teams — matches
// LEAGUE_SCORING.cfb.bonus ("Best combined win percentage") exactly, so
// whoever's #1 here is also who's currently on track for that bonus.
// Ties on percentage broken by total wins.
export function computeCfbDrafterCombined(){
  const league = LEAGUES.find(l => l.key === 'cfb');
  const byDrafter = {};
  DRAFT_TEAMS.forEach(d => {
    byDrafter[d.id] = { id: d.id, name: d.name, wins: 0, losses: 0, found: 0, total: 0, teamNames: [] };
  });

  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    byDrafter[meta.draftTeamId].total++;
    byDrafter[meta.draftTeamId].teamNames.push(meta.name);
  });

  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    const rec = findCfbRecord(meta);
    if(!rec || rec.wins === null) return;
    const bucket = byDrafter[meta.draftTeamId];
    bucket.wins += rec.wins;
    bucket.losses += rec.losses;
    bucket.found++;
  });

  return Object.values(byDrafter)
    .map(b => Object.assign(b, { pct: (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : null }))
    .sort((a, b) => {
      if(a.found === 0 && b.found === 0) return 0;
      if(a.found === 0) return 1;
      if(b.found === 0) return -1;
      if(b.pct !== a.pct) return b.pct - a.pct;
      return b.wins - a.wins;
    });
}

export function renderCfbByDrafterRow(row, rank){
  const teamsLabel = row.teamNames.join(' & ');
  let note = '';
  if(row.found === 0) note = 'No data yet';
  else if(row.found < row.total) note = `${row.found} of ${row.total} teams reporting`;

  // Same "currently leading, not locked in" idea as EPL's league-bonus
  // tag — the CFB bonus (best combined win percentage) only pays out
  // once the season actually ends. Purely a visual indicator here, same
  // as EPL's — doesn't feed into any point total on its own.
  const bonus = LEAGUE_SCORING.cfb.bonus;
  const isLeader = row.found > 0 && rank === 1 && bonus;
  const leaderTagHtml = isLeader ? `<span class="provisional-tag">+${bonus.pts} provisional</span>` : '';

  return `
    <div class="standings-row">
      <div class="standings-rank">${row.found > 0 ? rank : '—'}</div>
      <div class="team-main">
        <div class="team-name">${row.name}${leaderTagHtml}</div>
        <div class="team-sub">${teamsLabel}${note ? ' &middot; ' + note : ''}</div>
      </div>
      <div class="person-record-chip">${row.found > 0 ? `${row.wins}-${row.losses}${row.pct !== null ? ` &middot; ${Math.round(row.pct * 100)}%` : ''}` : '&mdash;'}</div>
    </div>
  `;
}
