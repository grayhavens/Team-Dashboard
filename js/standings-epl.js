/* ============================================================
   League Standings: EPL's real per-club table.
   Only EPL is wired to live data right now — TheSportsDB's free demo
   key returns a usable (if capped) table for it. Every other league
   came back empty when tested against the free key, so those just
   show a "no data" placeholder rather than pretending to fetch.
   If this moves to a premium key later, wire the rest up the same
   way EPL is done here.
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { fetchJSON, findDraftedTeamByName, teamBadgeHtml, abbrFromName } from './utils.js';
import { DASHBOARD_WORKER_BASE } from './api.js';
import { renderStandings } from './board.js';
import { liveDataCache, renderLiveBundle } from './live-data.js';

const EPL_LEAGUE_ID = '4328';
const EPL_API_SEASON = '2026-2027';
const EPL_STANDINGS_CACHE_KEY = 'teamDashboardEplStandingsCache';
// How long a fetched table is trusted before a background refresh is
// attempted again — matches the board's own ~15min refresh cadence.
// Doesn't gate *display*: a stale cached table (even one restored from
// localStorage from a previous session) is still shown immediately
// rather than blocked on a fresh fetch — same "show what we have, then
// quietly refresh" approach as the row-status pill cache.
const EPL_STANDINGS_TTL_MS = 15 * 60 * 1000;
export const eplStandingsCache = { table: null, error: false, loading: false, fetchedAt: null };
let eplStandingsPromise = null;

export function eplStandingsIsFresh(){
  return !!eplStandingsCache.table && !!eplStandingsCache.fetchedAt && (Date.now() - eplStandingsCache.fetchedAt) < EPL_STANDINGS_TTL_MS;
}

function saveEplStandingsCache(){
  try { localStorage.setItem(EPL_STANDINGS_CACHE_KEY, JSON.stringify(eplStandingsCache)); } catch (e){}
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
    const raw = localStorage.getItem(EPL_STANDINGS_CACHE_KEY);
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
    // Routed through the worker with the premium key (V1's lookuptable.php
    // has no V2 equivalent, but premium raises V1's own row cap too —
    // confirmed returning all 20 EPL rows instead of the free tier's 5,
    // see the migration plan's Phase 1 findings).
    const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/sportsdb/table/${EPL_LEAGUE_ID}/${EPL_API_SEASON}`);
    eplStandingsCache.loading = false;
    if(data && data.table && data.table.length){
      eplStandingsCache.table = data.table;
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
    // Modal stats (renderStats) read eplStandingsCache.table directly
    // rather than storing their own copy, so if the currently-open
    // team's modal is EPL, repaint it now that the table just changed.
    const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
    if(activeTeam && liveDataCache[activeTeam]) renderLiveBundle(activeTeam, liveDataCache[activeTeam]);
  })();
  return eplStandingsPromise;
}

export function renderStandingsRow(leagueKey, row){
  const teamKey = findDraftedTeamByName(leagueKey, row.strTeam);
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: row.strTeam,
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: abbrFromName(row.strTeam),
    badgeUrl: null
  };
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';

  return `
    <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
      <div class="standings-rank">${row.intRank}</div>
      ${teamBadgeHtml(meta)}
      <div class="team-main">
        <div class="team-name">${row.strTeam}</div>
        <div class="team-sub">${row.intWin}-${row.intDraw}-${row.intLoss} &middot; ${row.intPoints} pts</div>
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
    const teamKey = findDraftedTeamByName('epl', row.strTeam);
    if(!teamKey) return;
    const bucket = byDrafter[TEAM_META[teamKey].draftTeamId];
    bucket.win += parseInt(row.intWin, 10) || 0;
    bucket.draw += parseInt(row.intDraw, 10) || 0;
    bucket.loss += parseInt(row.intLoss, 10) || 0;
    bucket.points += parseInt(row.intPoints, 10) || 0;
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
