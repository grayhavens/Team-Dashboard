/* ============================================================
   NFL Standings: real conference standings, plus each drafter's
   combined win percentage across their 3 NFL teams.
   Like CFB, TheSportsDB's lookuptable.php returns genuinely empty for
   the NFL's league id (4391) across every season tested, current and
   historical (confirmed 2026-09-11) — so there's no real per-club
   table to pull from TheSportsDB here either.

   TheRundown's per-sport team list still backs per-team records (card
   records below, and the "Person" combined-win% view) — unchanged.

   The Conference standings view itself (below, computeNflConferenceStandings/
   renderNflStandingsRow) has moved OFF TheRundown and onto ESPN's hidden
   API (js/espn.js) instead — see docs/espn-migration-plan.md's Phase 3,
   same reasoning as CFB's AP Top 25 move in Phase 2: no shared metered
   budget to run out, no worker proxy needed (CORS-open, fetched
   directly). ESPN's simple standings endpoint only nests one level
   (conference — AFC/NFC, 16 teams each), NOT division — true
   division-by-division grouping (what this view showed before, via
   TheRundown's division field) needs a much heavier hypermedia fetch
   chain that wasn't worth building for this phase (see the plan doc's
   "NFL division standings" finding). So this is a deliberate step DOWN
   in grouping granularity in exchange for a data source that won't run
   out mid-week — re-evaluate if that trade stops feeling worth it.
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { fetchJSON, teamBadgeHtml, abbrFromName } from './utils.js';
import { DASHBOARD_WORKER_BASE, RUNDOWN_SPORT_ID } from './api.js';
import { fetchEspnNflStandings } from './espn.js';
import { renderStandings } from './board.js';
import { liveDataCache, renderStats } from './live-data.js';

const NFL_RECORDS_CACHE_KEY = 'teamDashboardNflRecordsCache';
// A team's record only changes after that team's own game (once a
// week, same cadence as CFB) — matches cfbRecordsCache's hour-long TTL,
// and the worker's own CACHE_TTL_SECONDS.rundownTeams, so both layers
// agree on freshness.
const NFL_RECORDS_TTL_MS = 60 * 60 * 1000;
export const nflRecordsCache = { byTeamId: null, error: false, loading: false, fetchedAt: null };
let nflRecordsPromise = null;

export function nflRecordsIsFresh(){
  return !!nflRecordsCache.byTeamId && !!nflRecordsCache.fetchedAt && (Date.now() - nflRecordsCache.fetchedAt) < NFL_RECORDS_TTL_MS;
}

function saveNflRecordsCache(){
  try { localStorage.setItem(NFL_RECORDS_CACHE_KEY, JSON.stringify(nflRecordsCache)); } catch (e){}
}

export function loadNflRecordsCache(){
  try {
    const raw = localStorage.getItem(NFL_RECORDS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.byTeamId){
      nflRecordsCache.byTeamId = parsed.byTeamId;
      nflRecordsCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

// "8-8-1" -> {wins:8, losses:8, ties:1}; "8-8" -> {wins:8, losses:8, ties:0}.
// Unlike CFB (no ties possible since 1996), the NFL can still end a
// game tied, so the third segment is read when present rather than
// assumed away — parseWinLossRecord in js/standings-cfb.js is the
// two-part version of this same idea.
export function parseNflRecord(record){
  const m = /^(\d+)-(\d+)(?:-(\d+))?/.exec(record || '');
  return m ? { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10), ties: parseInt(m[3] || '0', 10) } : null;
}

// Standard NFL win-percentage formula (a tie counts as half a win and
// half a loss) — null with no games played yet rather than 0, so a
// still-winless-but-untested team doesn't outrank one that hasn't
// played at all.
export function nflWinPct(rec){
  const total = rec.wins + rec.losses + rec.ties;
  return total > 0 ? (rec.wins + rec.ties * 0.5) / total : null;
}

export function fetchNflRecords(){
  if(nflRecordsCache.loading) return nflRecordsPromise;
  if(nflRecordsIsFresh()) return Promise.resolve();
  const sportId = RUNDOWN_SPORT_ID.nfl;
  if(!DASHBOARD_WORKER_BASE || !sportId) return Promise.resolve();

  nflRecordsCache.loading = true;
  nflRecordsPromise = (async () => {
    const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/teams/${sportId}`);
    nflRecordsCache.loading = false;
    // The response also bundles AFC/NFC conference-aggregate rows and a
    // placeholder "NFL Field"/"TBD" entry — none of those carry a
    // division, so filtering on that keeps just the 32 real teams.
    const teams = data && data.teams && data.teams.filter(t => t.division);
    if(teams && teams.length){
      const byTeamId = {};
      teams.forEach(t => { byTeamId[t.team_id] = t; });
      nflRecordsCache.byTeamId = byTeamId;
      nflRecordsCache.error = false;
      nflRecordsCache.fetchedAt = Date.now();
      saveNflRecordsCache();
    } else if(!nflRecordsCache.byTeamId){
      // Only flag "no data" if we never had a table to fall back on —
      // same "don't blank out a good cache on a transient miss" rule
      // fetchEplStandingsTable follows in js/standings-epl.js.
      nflRecordsCache.error = true;
    }
    renderStandings();
    renderAllNflCardRecords();

    // If an NFL team's modal happens to be open already (its stats cell
    // rendered before this fetch resolved), refresh it now rather than
    // leaving the fallback bio stats up until reopened.
    const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
    const activeMeta = activeTeam && TEAM_META[activeTeam];
    if(activeMeta && activeMeta.leagueKey === 'nfl'){
      renderStats(activeMeta, liveDataCache[activeTeam] || {});
    }
  })();
  return nflRecordsPromise;
}

// Record shown on each NFL team's board row — same nflRecordsCache the
// Standings tab already fetches, just painted onto the per-team span
// rather than re-rendering the whole board (mirrors renderCfbCardRecord
// in js/standings-cfb.js).
export function nflRecordLabel(meta){
  const rec = meta.rundownTeamId ? (nflRecordsCache.byTeamId || {})[meta.rundownTeamId] : null;
  if(!rec || !rec.record) return '';
  const parsed = parseNflRecord(rec.record);
  return parsed ? `${parsed.wins}-${parsed.losses}${parsed.ties ? '-' + parsed.ties : ''}` : rec.record;
}

export function renderNflCardRecord(teamKey){
  const el = document.getElementById('nfl-record-' + teamKey);
  if(!el) return;
  const label = nflRecordLabel(TEAM_META[teamKey]);
  el.innerHTML = label ? ` &middot; ${label}` : '';
}

export function renderAllNflCardRecords(){
  LEAGUES.find(l => l.key === 'nfl').teams.forEach(renderNflCardRecord);
}

// ---- Conference standings (ESPN-sourced — see the file header comment) ----

const ESPN_NFL_STANDINGS_CACHE_KEY = 'teamDashboardEspnNflStandingsCache';
// Standings can move the moment a game ends, so this stays on the same
// cadence as nflRecordsCache below rather than CFB's poll-driven
// once-a-week cache — matched here, not lengthened, even though it's a
// direct unproxied fetch with no shared budget to protect.
const ESPN_NFL_STANDINGS_TTL_MS = 60 * 60 * 1000;
export const espnNflStandingsCache = { rows: null, error: false, loading: false, fetchedAt: null };
let espnNflStandingsPromise = null;

function espnNflStandingsIsFresh(){
  return !!espnNflStandingsCache.rows && !!espnNflStandingsCache.fetchedAt && (Date.now() - espnNflStandingsCache.fetchedAt) < ESPN_NFL_STANDINGS_TTL_MS;
}

function saveEspnNflStandingsCache(){
  try { localStorage.setItem(ESPN_NFL_STANDINGS_CACHE_KEY, JSON.stringify(espnNflStandingsCache)); } catch (e){}
}

export function loadEspnNflStandingsCache(){
  try {
    const raw = localStorage.getItem(ESPN_NFL_STANDINGS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.rows){
      espnNflStandingsCache.rows = parsed.rows;
      espnNflStandingsCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

export function fetchEspnNflStandingsCached(){
  if(espnNflStandingsCache.loading) return espnNflStandingsPromise;
  if(espnNflStandingsIsFresh()) return Promise.resolve();

  espnNflStandingsCache.loading = true;
  espnNflStandingsPromise = (async () => {
    const rows = await fetchEspnNflStandings();
    espnNflStandingsCache.loading = false;
    if(rows && rows.length){
      espnNflStandingsCache.rows = rows;
      espnNflStandingsCache.error = false;
      espnNflStandingsCache.fetchedAt = Date.now();
      saveEspnNflStandingsCache();
    } else if(!espnNflStandingsCache.rows){
      // Same "don't blank out a good cache on a transient miss" rule as
      // nflRecordsCache/cfbRecordsCache.
      espnNflStandingsCache.error = true;
    }
    renderStandings();
  })();
  return espnNflStandingsPromise;
}

// ESPN's abbreviation ("WSH") doesn't always match this app's own
// badgeText ("WAS") — checked every one of the 27 currently-drafted NFL
// teams against a live ESPN standings pull (2026-09-11): Washington is
// the only mismatch, everything else matches verbatim. Same manual-
// override idea as CFB_ESPN_NAME_OVERRIDES in js/standings-cfb.js.
const NFL_ESPN_ABBR_OVERRIDES = {
  'WSH': 'WAS'
};

function findNflTeamKeyByEspnAbbr(abbr){
  const wanted = NFL_ESPN_ABBR_OVERRIDES[abbr] || abbr;
  const teams = LEAGUES.find(l => l.key === 'nfl').teams;
  return teams.find(teamKey => TEAM_META[teamKey].badgeText === wanted) || null;
}

// Conference-only grouping (AFC/NFC, 16 teams each) — see the file
// header comment for why this isn't division-by-division. Sorted by
// win% within each conference, ties broken by name.
export function computeNflConferenceStandings(){
  const rows = espnNflStandingsCache.rows || [];
  const groups = {}; // conferenceAbbr -> [row, ...]
  rows.forEach(row => {
    (groups[row.conferenceAbbr] || (groups[row.conferenceAbbr] = [])).push(row);
  });

  Object.values(groups).forEach(list => {
    list.sort((a, b) => {
      const pa = a.winPercent ?? -1, pb = b.winPercent ?? -1;
      if(pb !== pa) return pb - pa;
      return a.teamName.localeCompare(b.teamName);
    });
  });

  return Object.keys(groups).sort().map(abbr => ({ name: abbr, teams: groups[abbr] }));
}

export function renderNflGroupHeader(label){
  return `<div class="standings-group-header">${label}</div>`;
}

export function renderNflStandingsRow(row, rank){
  const teamKey = findNflTeamKeyByEspnAbbr(row.abbreviation);
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: row.teamName,
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: row.abbreviation || abbrFromName(row.teamName),
    badgeUrl: null
  };
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';
  const recordLabel = `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`;

  return `
    <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
      <div class="standings-rank">${rank}</div>
      ${teamBadgeHtml(meta)}
      <div class="team-main">
        <div class="team-name">${meta.name}</div>
        <div class="team-sub">${recordLabel}</div>
      </div>
      ${draftedByHtml}
    </div>
  `;
}

// Toggle between the real conference standings and each drafter's
// combined record — same idea as eplStandingsMode/cfbStandingsMode.
// Defaults to "conference" since that's the real external data,
// matching EPL's "table" / CFB's "ranking" default. Named "conference"
// (not the old "division") to be honest about what's actually shown —
// see the file header comment.
export let nflStandingsMode = 'conference';

export function setNflStandingsMode(mode){
  nflStandingsMode = mode;
  renderStandings();
}
window.setNflStandingsMode = setNflStandingsMode;

export function nflStandingsToggleHtml(){
  return `
    <div class="standings-toggle">
      <button class="toggle-btn ${nflStandingsMode === 'conference' ? 'active' : ''}" onclick="setNflStandingsMode('conference')">Conference</button>
      <button class="toggle-btn ${nflStandingsMode === 'byDrafter' ? 'active' : ''}" onclick="setNflStandingsMode('byDrafter')">Person</button>
    </div>
  `;
}

// Combined win percentage across each drafter's 3 NFL teams — matches
// LEAGUE_SCORING.nfl.bonus ("Best combined win percentage") exactly, so
// whoever's #1 here is also who's currently on track for that bonus.
// Ties on percentage broken by total wins.
export function computeNflDrafterCombined(){
  const league = LEAGUES.find(l => l.key === 'nfl');
  const byDrafter = {};
  DRAFT_TEAMS.forEach(d => {
    byDrafter[d.id] = { id: d.id, name: d.name, wins: 0, losses: 0, ties: 0, found: 0, total: 0, teamNames: [] };
  });

  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    byDrafter[meta.draftTeamId].total++;
    byDrafter[meta.draftTeamId].teamNames.push(meta.name);
  });

  const byTeamId = nflRecordsCache.byTeamId || {};
  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    const team = meta.rundownTeamId ? byTeamId[meta.rundownTeamId] : null;
    const rec = team && parseNflRecord(team.record);
    if(!rec) return;
    const bucket = byDrafter[meta.draftTeamId];
    bucket.wins += rec.wins;
    bucket.losses += rec.losses;
    bucket.ties += rec.ties;
    bucket.found++;
  });

  return Object.values(byDrafter)
    .map(b => Object.assign(b, { pct: nflWinPct(b) }))
    .sort((a, b) => {
      if(a.found === 0 && b.found === 0) return 0;
      if(a.found === 0) return 1;
      if(b.found === 0) return -1;
      const pa = a.pct ?? -1, pb = b.pct ?? -1;
      if(pb !== pa) return pb - pa;
      return b.wins - a.wins;
    });
}

export function renderNflByDrafterRow(row, rank){
  const teamsLabel = row.teamNames.join(' & ');
  let note = '';
  if(row.found === 0) note = 'No data yet';
  else if(row.found < row.total) note = `${row.found} of ${row.total} teams reporting`;

  // Same "currently leading, not locked in" idea as EPL/CFB's league-bonus
  // tag — the NFL bonus (best combined win percentage) only pays out once
  // the season actually ends.
  const bonus = LEAGUE_SCORING.nfl.bonus;
  const isLeader = row.found > 0 && rank === 1 && bonus;
  const leaderTagHtml = isLeader ? `<span class="provisional-tag">+${bonus.pts} provisional</span>` : '';

  const recordLabel = row.found > 0
    ? `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}${row.pct !== null ? ` &middot; ${Math.round(row.pct * 100)}%` : ''}`
    : '&mdash;';

  return `
    <div class="standings-row">
      <div class="standings-rank">${row.found > 0 ? rank : '—'}</div>
      <div class="team-main">
        <div class="team-name">${row.name}${leaderTagHtml}</div>
        <div class="team-sub">${teamsLabel}${note ? ' &middot; ' + note : ''}</div>
      </div>
      <div class="person-record-chip">${recordLabel}</div>
    </div>
  `;
}
