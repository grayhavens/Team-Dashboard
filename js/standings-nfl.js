/* ============================================================
   NFL Standings: real division/conference standings, plus each
   drafter's combined win percentage across their 3 NFL teams.
   Like CFB, TheSportsDB's lookuptable.php returns genuinely empty for
   the NFL's league id (4391) across every season tested, current and
   historical (confirmed 2026-09-11) — so there's no real per-club
   table to pull from TheSportsDB here either.

   TheRundown's per-sport team list (the same endpoint CFB's
   fetchCfbRecords already uses) carries a "record" field for the NFL
   too, plus something CFB's response doesn't have: real conference and
   division objects per team ("AFC North", "NFC West", etc.) — enough
   to build actual division standings without a second data source.
   One shared fetch for the whole league (mirrors cfbRecordsCache/
   eplStandingsCache: one call, not one per team), reusing the existing
   /teams/{sportId} worker route.
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { fetchJSON, findDraftedTeamByRundownId, teamBadgeHtml, abbrFromName } from './utils.js';
import { DASHBOARD_WORKER_BASE, RUNDOWN_SPORT_ID } from './api.js';
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

// Real division standings, grouped the way the NFL itself groups them
// (conference, then division, teams ranked by win% within it) rather
// than one flat table — unlike EPL there's no single ranking that means
// anything across all 32 teams. TheRundown's division.name is already
// shaped "AFC North" / "NFC West" etc., so the conference prefix and
// division suffix are pulled straight out of it rather than trusting
// object key order.
const CONFERENCE_PREFIXES = ['AFC', 'NFC'];
const DIVISION_SUFFIXES = ['East', 'North', 'South', 'West'];

export function computeNflDivisionStandings(){
  const byTeamId = nflRecordsCache.byTeamId || {};
  const groups = {}; // "AFC East" etc -> [team, ...]
  Object.values(byTeamId).forEach(t => {
    const divName = t.division && t.division.name;
    if(!divName) return;
    (groups[divName] || (groups[divName] = [])).push(t);
  });

  Object.values(groups).forEach(list => {
    list.sort((a, b) => {
      const pa = nflWinPct(parseNflRecord(a.record) || { wins: 0, losses: 0, ties: 0 }) ?? -1;
      const pb = nflWinPct(parseNflRecord(b.record) || { wins: 0, losses: 0, ties: 0 }) ?? -1;
      if(pb !== pa) return pb - pa;
      return a.name.localeCompare(b.name);
    });
  });

  const conferences = [];
  CONFERENCE_PREFIXES.forEach(prefix => {
    const divisions = DIVISION_SUFFIXES
      .map(suffix => `${prefix} ${suffix}`)
      .filter(divName => groups[divName])
      .map(divName => ({ name: divName, teams: groups[divName] }));
    if(divisions.length) conferences.push({ name: prefix, divisions });
  });
  return conferences;
}

export function renderNflGroupHeader(label){
  return `<div class="standings-group-header">${label}</div>`;
}

export function renderNflStandingsRow(team, rank){
  const teamKey = findDraftedTeamByRundownId('nfl', team.team_id);
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: `${team.name} ${team.mascot}`.trim(),
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: team.abbreviation || abbrFromName(team.name),
    badgeUrl: null
  };
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';
  const rec = parseNflRecord(team.record);
  const recordLabel = rec ? `${rec.wins}-${rec.losses}${rec.ties ? '-' + rec.ties : ''}` : (team.record || '');

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

// Toggle between the real division-by-division standings and each
// drafter's combined record — same idea as eplStandingsMode/
// cfbStandingsMode. Defaults to "division" since that's the real
// external data, matching EPL's "table" / CFB's "ranking" default.
export let nflStandingsMode = 'division';

export function setNflStandingsMode(mode){
  nflStandingsMode = mode;
  renderStandings();
}
window.setNflStandingsMode = setNflStandingsMode;

export function nflStandingsToggleHtml(){
  return `
    <div class="standings-toggle">
      <button class="toggle-btn ${nflStandingsMode === 'division' ? 'active' : ''}" onclick="setNflStandingsMode('division')">Divisions</button>
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
