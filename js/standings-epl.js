/* ============================================================
   League Standings: EPL's real per-club table.

   Reads ESPN's hidden API (js/espn.js) — see docs/espn-migration-plan.md's
   EPL phase. This used to read TheSportsDB V1's lookuptable.php, routed
   through the worker with the premium key (V1 has no CORS, unlike
   ESPN); that's fully retired from this file now, including the
   worker's own /sportsdb/table route. No worker proxy needed here
   either (CORS-open, fetched directly) — same as NFL/CFB.
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { findDraftedTeamByName, normalizeTeamName, teamBadgeHtml, abbrFromName, ordinal } from './utils.js';
import { fetchEspnEplStandings } from './espn.js';
import { renderStandings } from './board.js';
import { liveDataCache, renderLiveBundle } from './live-data.js';

const ESPN_EPL_STANDINGS_CACHE_KEY = 'teamDashboardEspnEplStandingsCache';
// Standings can move the moment a match ends, so this stays on the same
// hourly cadence as NFL's ESPN-sourced cache (ESPN_NFL_STANDINGS_TTL_MS
// in js/standings-nfl.js) rather than the old 15min TTL that was tuned
// for TheSportsDB's own refresh cadence.
const EPL_STANDINGS_TTL_MS = 60 * 60 * 1000;
export const eplStandingsCache = { table: null, error: false, loading: false, fetchedAt: null };
let eplStandingsPromise = null;

export function eplStandingsIsFresh(){
  return !!eplStandingsCache.table && !!eplStandingsCache.fetchedAt && (Date.now() - eplStandingsCache.fetchedAt) < EPL_STANDINGS_TTL_MS;
}

function saveEplStandingsCache(){
  try { localStorage.setItem(ESPN_EPL_STANDINGS_CACHE_KEY, JSON.stringify(eplStandingsCache)); } catch (e){}
}

// One shared table for every EPL team — modal stats, the Standings
// tab's League/Person views, and the League Facts rank-auto rules
// (getLeagueRuleTeams in js/league-facts.js) all read
// eplStandingsCache.table directly rather than each fetching or
// storing their own copy. This is what keeps a growing roster of EPL
// teams (more drafters' clubs getting wired up over time) at one
// request instead of one per team, and keeps localStorage from ending
// up with N duplicate copies of the same ~20-row table.
export function loadEplStandingsCache(){
  try {
    const raw = localStorage.getItem(ESPN_EPL_STANDINGS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.table){
      eplStandingsCache.table = parsed.table;
      eplStandingsCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

// Callers (fetchTeamBundle for each EPL team, renderStandings) all
// await the same in-flight promise when a fetch is already running,
// instead of firing their own — this is the actual "load once" part.
export function fetchEplStandingsTable(){
  if(eplStandingsCache.loading) return eplStandingsPromise;
  if(eplStandingsIsFresh()) return Promise.resolve();

  eplStandingsCache.loading = true;
  eplStandingsPromise = (async () => {
    const rows = await fetchEspnEplStandings();
    eplStandingsCache.loading = false;
    if(rows && rows.length){
      eplStandingsCache.table = rows;
      eplStandingsCache.error = false;
      eplStandingsCache.fetchedAt = Date.now();
      saveEplStandingsCache();
    } else if(!eplStandingsCache.table){
      // Only flag "no data" if we never had a table to fall back on —
      // a transient failure on a background refresh should keep
      // showing the last-known-good table, not blank it out.
      eplStandingsCache.error = true;
    }
    renderStandings();
    renderAllEplCardRecords();
    // Modal stats (renderStats) read eplStandingsCache.table directly
    // rather than storing their own copy, so if the currently-open
    // team's modal is EPL, repaint it now that the table just changed.
    const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
    if(activeTeam && liveDataCache[activeTeam]) renderLiveBundle(activeTeam, liveDataCache[activeTeam]);
  })();
  return eplStandingsPromise;
}

// ESPN's full club names ("Manchester City", "Manchester United") match
// this app's abbreviated meta.name ("Man City", "Man United") via
// findDraftedTeamByName as-is — normalizeTeamName (js/utils.js) already
// carries a 'man city'/'man united' alias for exactly this mismatch, so
// no EPL-specific override table is needed here, unlike CFB/NFL's own
// name/abbreviation overrides.
export function findEplTeamKeyByEspnName(espnTeamName){
  return findDraftedTeamByName('epl', espnTeamName);
}

// The reverse direction — given a drafted team's own meta, find its row
// in the ESPN standings cache. Used by eplRecordLabel (board cards) and
// js/live-data.js's EPL stat cell, so every place this app shows an EPL
// team's record reads the exact same ESPN data the Standings tab does.
// Mirrors findEspnNflRow in js/standings-nfl.js.
export function findEspnEplRow(meta){
  const rows = eplStandingsCache.table;
  if(!rows) return null;
  const wanted = normalizeTeamName(meta.name);
  return rows.find(row => {
    const candidate = normalizeTeamName(row.teamName);
    return candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate);
  }) || null;
}

// Record + table position shown on each EPL team's board row, in place
// of the static "Premier League" boardSub text (every EPL team is in
// the same league, so that label carried no information) — same
// eplStandingsCache the Standings tab already fetches, just painted
// onto the per-team span rather than re-rendering the whole board (see
// cfbRecordLabel/renderCfbCardRecord in js/standings-cfb.js for the
// identical pattern on the CFB side).
export function eplRecordLabel(meta){
  const row = findEspnEplRow(meta);
  if(!row) return '';
  return `${row.wins}-${row.draws}-${row.losses} &middot; ${ordinal(row.rank)}`;
}

export function renderEplCardRecord(teamKey){
  const el = document.getElementById('epl-record-' + teamKey);
  if(!el) return;
  el.innerHTML = eplRecordLabel(TEAM_META[teamKey]) || 'Premier League';
}

export function renderAllEplCardRecords(){
  LEAGUES.find(l => l.key === 'epl').teams.forEach(renderEplCardRecord);
}

export function renderStandingsRow(leagueKey, row){
  const teamKey = findEplTeamKeyByEspnName(row.teamName);
  // An undrafted club has no TEAM_META entry (so no SportsDB badge),
  // but ESPN's own logoUrl covers it — real crest, same onerror
  // fallback to the plain monogram if it ever fails (see
  // renderNflStandingsRow in js/standings-nfl.js for the identical
  // pattern on the NFL side).
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: row.teamName,
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: row.abbreviation || abbrFromName(row.teamName),
    badgeUrl: row.logoUrl || null
  };
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';

  return `
    <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
      <div class="standings-rank">${row.rank}</div>
      ${teamBadgeHtml(meta)}
      <div class="team-main">
        <div class="team-name">${row.teamName}</div>
        <div class="team-sub">${row.wins}-${row.draws}-${row.losses} &middot; ${row.points} pts</div>
      </div>
      ${draftedByHtml}
    </div>
  `;
}

// Toggle between the real club-by-club table and each drafter's
// combined record — the latter is what determines the league's
// 5-point "best combined record" bonus (see LEAGUE_SCORING[key].bonus).
export let eplStandingsMode = 'table';

export function setEplStandingsMode(mode){
  eplStandingsMode = mode;
  renderStandings();
}
window.setEplStandingsMode = setEplStandingsMode;

export function computeEplDrafterCombined(){
  const league = LEAGUES.find(l => l.key === 'epl');
  const byDrafter = {};
  DRAFT_TEAMS.forEach(d => {
    byDrafter[d.id] = { id: d.id, name: d.name, win: 0, draw: 0, loss: 0, points: 0, found: 0, total: 0, teamNames: [] };
  });

  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    byDrafter[meta.draftTeamId].total++;
    byDrafter[meta.draftTeamId].teamNames.push(meta.name);
  });

  (eplStandingsCache.table || []).forEach(row => {
    const teamKey = findEplTeamKeyByEspnName(row.teamName);
    if(!teamKey) return;
    const bucket = byDrafter[TEAM_META[teamKey].draftTeamId];
    bucket.win += row.wins || 0;
    bucket.draw += row.draws || 0;
    bucket.loss += row.losses || 0;
    bucket.points += row.points || 0;
    bucket.found++;
  });

  return Object.values(byDrafter).sort((a, b) => {
    if(a.found === 0 && b.found === 0) return 0;
    if(a.found === 0) return 1;
    if(b.found === 0) return -1;
    return b.points - a.points;
  });
}

export function renderEplByDrafterRow(row, rank){
  const teamsLabel = row.teamNames.join(' & ');
  let note = '';
  if(row.found === 0) note = 'No data yet';
  else if(row.found < row.total) note = `${row.found} of ${row.total} teams reporting`;

  // The league bonus (LEAGUE_SCORING.epl.bonus — "highest combined
  // record") goes to whoever's on top when the season actually ends.
  // Flagging it for whoever's CURRENTLY #1 here is the same
  // not-locked-in idea as the per-team rank rules, just applied to
  // this cross-drafter ranking instead of a single team's table spot.
  const bonus = LEAGUE_SCORING.epl.bonus;
  const isLeader = row.found > 0 && rank === 1 && bonus;
  const leaderTagHtml = isLeader ? `<span class="provisional-tag">+${bonus.pts} provisional</span>` : '';

  return `
    <div class="standings-row">
      <div class="standings-rank">${row.found > 0 ? rank : '—'}</div>
      <div class="team-main">
        <div class="team-name">${row.name}${leaderTagHtml}</div>
        <div class="team-sub">${teamsLabel}${note ? ' &middot; ' + note : ''}</div>
      </div>
      <div class="person-record-chip">${row.found > 0 ? `${row.win}-${row.draw}-${row.loss} &middot; ${row.points} pts` : '&mdash;'}</div>
    </div>
  `;
}

export function eplStandingsToggleHtml(){
  return `
    <div class="standings-toggle">
      <button class="toggle-btn ${eplStandingsMode === 'table' ? 'active' : ''}" onclick="setEplStandingsMode('table')">League</button>
      <button class="toggle-btn ${eplStandingsMode === 'byDrafter' ? 'active' : ''}" onclick="setEplStandingsMode('byDrafter')">Person</button>
    </div>
  `;
}
