/* ============================================================
   NFL Standings: real division-by-division standings, real
   conference-wide ranking, and each drafter's combined win percentage
   across their 3 NFL teams — three separate views because division
   winner and best-record-in-conference are two different scoring
   bonuses (see LEAGUE_SCORING.nfl), not just one flat ranking like
   EPL's table or CFB's Top 25.
   Like CFB, TheSportsDB's lookuptable.php returns genuinely empty for
   the NFL's league id (4391) across every season tested, current and
   historical (confirmed 2026-09-11) — so there's no real per-club
   table to pull from TheSportsDB here either.

   Every view here (Divisions, Conference, the per-team record used on
   board cards/the modal, and the "Person" combined-win% breakdown)
   reads ESPN's hidden API (js/espn.js) — see docs/espn-migration-plan.md's
   Phase 3. TheRundown's per-sport team list used to back all of this
   but is fully retired from this file: unlike CFB (whose ESPN rankings
   endpoint only covers the Top 25 — not enough for a full-roster
   combined-win% view, so CFB's "Person" tab stays on TheRundown), ESPN's
   NFL standings endpoints already cover all 32 teams, so there's no
   coverage gap keeping any part of this file on the metered source. No
   worker proxy needed either (CORS-open, fetched directly).

   Two different ESPN endpoints back this file, at two different costs:
   fetchEspnNflStandings (js/espn.js) is one flat request, conference-
   only — that's what backs the record shown on cards/the modal/Person
   AND the Conference view (computeNflConferenceStandings just groups
   those same rows by conference — free, no extra fetch). Division-by-
   division grouping needs 9 requests instead (fetchEspnNflDivisionStandings)
   since ESPN's simple endpoint doesn't have divisions at all — see that
   function's own comment in js/espn.js for the full hypermedia chain.
   Kept as a separate cache/fetch (espnNflDivisionCache below)
   specifically so the cheap flat data everything else needs doesn't pay
   for the expensive division fetch every time.
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { teamBadgeHtml, abbrFromName } from './utils.js';
import { fetchEspnNflStandings, fetchEspnNflDivisionStandings } from './espn.js';
import { renderStandings } from './board.js';
import { liveDataCache, renderStats } from './live-data.js';

// Standard NFL win-percentage formula (a tie counts as half a win and
// half a loss) — null with no games played yet rather than 0, so a
// still-winless-but-untested team doesn't outrank one that hasn't
// played at all.
export function nflWinPct(rec){
  const total = rec.wins + rec.losses + rec.ties;
  return total > 0 ? (rec.wins + rec.ties * 0.5) / total : null;
}

// Record shown on each NFL team's board row — same espnNflStandingsCache
// the Standings tab already fetches, just painted onto the per-team
// span rather than re-rendering the whole board (mirrors
// renderCfbCardRecord in js/standings-cfb.js). Unlike CFB's ranking
// pull (Top 25 only), ESPN's NFL standings cover all 32 teams, so this
// can fully replace the old TheRundown-sourced version instead of only
// overlaying part of it — see findEspnNflRow below.
export function nflRecordLabel(meta){
  const row = findEspnNflRow(meta);
  if(!row) return '';
  return `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`;
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
// Standings can move the moment a game ends, so this stays on an
// hourly cadence rather than CFB's poll-driven once-a-week cache —
// matched here, not lengthened, even though it's a direct unproxied
// fetch with no shared budget to protect.
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
      // cfbRecordsCache in js/standings-cfb.js.
      espnNflStandingsCache.error = true;
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
  return espnNflStandingsPromise;
}

// ESPN's abbreviation ("WSH") doesn't always match this app's own
// badgeText ("WAS") — checked every one of the 30 currently-drafted NFL
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

// The reverse direction of findNflTeamKeyByEspnAbbr — given a drafted
// team's own meta, find its row in the ESPN standings cache. Used by
// nflRecordLabel (board cards) and js/live-data.js's NFL stat cell, so
// every place this app shows an NFL team's record reads the exact same
// ESPN data the Standings tab does, instead of drifting between sources.
export function findEspnNflRow(meta){
  const rows = espnNflStandingsCache.rows;
  if(!rows || !meta.badgeText) return null;
  return rows.find(row => (NFL_ESPN_ABBR_OVERRIDES[row.abbreviation] || row.abbreviation) === meta.badgeText) || null;
}

// One conference's full 16-team ranking — distinct from the Division
// breakdown below: division winner and best-record-in-conference are
// two different scoring bonuses (see LEAGUE_SCORING.nfl), so a team can
// be worth tracking in one view without leading the other. Reads the
// same cheap flat espnNflStandingsCache the "Person" view already uses
// (conference is a field right there on each row), so this costs
// nothing extra over what's already fetched — no separate cache needed.
export function computeNflConferenceStandings(conferenceAbbr){
  const rows = (espnNflStandingsCache.rows || []).filter(row => row.conferenceAbbr === conferenceAbbr);
  return rows.sort((a, b) => {
    const pa = a.winPercent ?? -1, pb = b.winPercent ?? -1;
    if(pb !== pa) return pb - pa;
    return a.teamName.localeCompare(b.teamName);
  });
}

// ---- Division standings (the heavier ESPN fetch — see the file header comment) ----

const ESPN_NFL_DIVISIONS_CACHE_KEY = 'teamDashboardEspnNflDivisionsCache';
// Same hourly cadence as the flat cache above — standings can move the
// moment a game ends, so there's no reason to let this one go stale
// longer just because it costs more requests to refresh.
const ESPN_NFL_DIVISIONS_TTL_MS = 60 * 60 * 1000;
export const espnNflDivisionCache = { divisions: null, error: false, loading: false, fetchedAt: null };
let espnNflDivisionPromise = null;

function espnNflDivisionIsFresh(){
  return !!espnNflDivisionCache.divisions && !!espnNflDivisionCache.fetchedAt && (Date.now() - espnNflDivisionCache.fetchedAt) < ESPN_NFL_DIVISIONS_TTL_MS;
}

function saveEspnNflDivisionCache(){
  try { localStorage.setItem(ESPN_NFL_DIVISIONS_CACHE_KEY, JSON.stringify(espnNflDivisionCache)); } catch (e){}
}

export function loadEspnNflDivisionCache(){
  try {
    const raw = localStorage.getItem(ESPN_NFL_DIVISIONS_CACHE_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    if(parsed && parsed.divisions){
      espnNflDivisionCache.divisions = parsed.divisions;
      espnNflDivisionCache.fetchedAt = parsed.fetchedAt || null;
    }
  } catch (e){}
}

export function fetchEspnNflDivisionStandingsCached(){
  if(espnNflDivisionCache.loading) return espnNflDivisionPromise;
  if(espnNflDivisionIsFresh()) return Promise.resolve();

  espnNflDivisionCache.loading = true;
  espnNflDivisionPromise = (async () => {
    const divisions = await fetchEspnNflDivisionStandings();
    espnNflDivisionCache.loading = false;
    if(divisions && divisions.length){
      espnNflDivisionCache.divisions = divisions;
      espnNflDivisionCache.error = false;
      espnNflDivisionCache.fetchedAt = Date.now();
      saveEspnNflDivisionCache();
    } else if(!espnNflDivisionCache.divisions){
      // Same "don't blank out a good cache on a transient miss" rule as
      // the flat cache above.
      espnNflDivisionCache.error = true;
    }
    renderStandings();
    // The team modal's Division stat cell (js/live-data.js's
    // renderStats) reads this same cache, and can easily open before
    // this heavier fetch resolves (it's only triggered on-demand, not
    // eagerly at boot) — same "activeTeam" re-render idea as
    // fetchEspnNflStandingsCached above, just for this cache instead.
    const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
    const activeMeta = activeTeam && TEAM_META[activeTeam];
    if(activeMeta && activeMeta.leagueKey === 'nfl'){
      renderStats(activeMeta, liveDataCache[activeTeam] || {});
    }
  })();
  return espnNflDivisionPromise;
}

// Already grouped and ordered by fetchEspnNflDivisionStandings (AFC
// East/North/South/West, NFC East/North/South/West) — this just sorts
// each division's 4 teams by win%, ties broken by name, same rule the
// old conference-only version used.
// conferenceAbbr ('AFC'/'NFC') narrows to that conference's 4
// divisions — division names are "AFC East" etc, so a simple prefix
// match does it, no separate conference field needed on each division.
export function computeNflDivisionStandings(conferenceAbbr){
  const divisions = espnNflDivisionCache.divisions || [];
  return divisions
    .filter(d => d.division.startsWith(conferenceAbbr))
    .map(d => ({
      name: d.division,
      teams: [...d.teams].sort((a, b) => {
        const pa = a.winPercent ?? -1, pb = b.winPercent ?? -1;
        if(pb !== pa) return pb - pa;
        return a.teamName.localeCompare(b.teamName);
      })
    }));
}

export function renderNflGroupHeader(label){
  return `<div class="standings-group-header">${label}</div>`;
}

// Given a drafted team's own meta, find which division it's in — used
// by the team modal's Division stat cell (js/live-data.js). Matches by
// badgeText/abbreviation the same way findEspnNflRow does, since a
// division-cache team entry carries no direct link back to TEAM_META.
function findNflDivisionForMeta(meta){
  const divisions = espnNflDivisionCache.divisions;
  if(!divisions || !meta.badgeText) return null;
  return divisions.find(div => div.teams.some(t => (NFL_ESPN_ABBR_OVERRIDES[t.abbreviation] || t.abbreviation) === meta.badgeText)) || null;
}

// The bare division name ("North"), not the full "AFC North" — the
// conference is always shown as its own, separate stat cell right next
// to this one, so repeating it here would be redundant.
export function nflDivisionLabel(meta){
  const div = findNflDivisionForMeta(meta);
  return div ? div.division.replace(/^(AFC|NFC)\s+/, '') : null;
}

export function renderNflStandingsRow(row, rank){
  const teamKey = findNflTeamKeyByEspnAbbr(row.abbreviation);
  // Same idea as CFB's renderCfbRankingRow: an undrafted team has no
  // SportsDB badge, but ESPN's own logoUrl covers it — real crest,
  // same onerror fallback to the plain monogram if it ever fails.
  // Mascot only ("Browns"), not the full "Cleveland Browns" — keeps
  // undrafted rows consistent with how every drafted team's own
  // TEAM_META.name is styled (mascot-only) across this app.
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: row.teamNickname || row.teamName,
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: row.abbreviation || abbrFromName(row.teamName),
    badgeUrl: row.logoUrl || null
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

// Nested toggle, two rows: which conference (AFC/NFC — plus "Person",
// which isn't conference-scoped) on top, then — only when a conference
// is selected — Divisions vs. the conference's Full 16-team ranking
// underneath. Replaces a single flat Divisions/Conference/Person switch
// that always showed 32 or 16 teams at once; picking a conference first
// halves that immediately, and Divisions-within-a-conference halves it
// again (4 teams per group instead of 8 groups of 4 all at once).
// Division winner and best-record-in-conference are two different
// scoring bonuses (LEAGUE_SCORING.nfl), so both stay real options, not
// just one flattened into the other.
export let nflStandingsMode = 'afc'; // 'afc' | 'nfc' | 'byDrafter'
export let nflConferenceSubMode = 'division'; // 'division' | 'full' — only meaningful when nflStandingsMode is 'afc'/'nfc'

export function setNflStandingsMode(mode){
  nflStandingsMode = mode;
  renderStandings();
}
window.setNflStandingsMode = setNflStandingsMode;

export function setNflConferenceSubMode(subMode){
  nflConferenceSubMode = subMode;
  renderStandings();
}
window.setNflConferenceSubMode = setNflConferenceSubMode;

export function nflStandingsToggleHtml(){
  const topRow = `
    <div class="standings-toggle">
      <button class="toggle-btn ${nflStandingsMode === 'afc' ? 'active' : ''}" onclick="setNflStandingsMode('afc')">AFC</button>
      <button class="toggle-btn ${nflStandingsMode === 'nfc' ? 'active' : ''}" onclick="setNflStandingsMode('nfc')">NFC</button>
      <button class="toggle-btn ${nflStandingsMode === 'byDrafter' ? 'active' : ''}" onclick="setNflStandingsMode('byDrafter')">Person</button>
    </div>
  `;
  if(nflStandingsMode === 'byDrafter') return topRow;

  const subRow = `
    <div class="standings-toggle standings-subtoggle">
      <button class="toggle-btn ${nflConferenceSubMode === 'division' ? 'active' : ''}" onclick="setNflConferenceSubMode('division')">Divisions</button>
      <button class="toggle-btn ${nflConferenceSubMode === 'full' ? 'active' : ''}" onclick="setNflConferenceSubMode('full')">Conference</button>
    </div>
  `;
  return topRow + subRow;
}

// Combined win percentage across each drafter's 3 NFL teams — matches
// LEAGUE_SCORING.nfl.bonus ("Best combined win percentage") exactly, so
// whoever's #1 here is also who's currently on track for that bonus.
// Ties on percentage broken by total wins.
//
// Reads espnNflStandingsCache rather than TheRundown — unlike CFB's
// equivalent (which stays on TheRundown because ESPN's CFB endpoint
// only covers the Top 25, not the full roster most drafted CFB teams
// need), ESPN's NFL standings already cover all 32 teams, so there's
// no coverage gap forcing this one to stay on the metered source. Same
// computation/rendering shape as CFB's version either way (see
// computeCfbDrafterCombined in js/standings-cfb.js) — only where the
// win/loss numbers come from differs.
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

  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    const row = findEspnNflRow(meta);
    if(!row) return;
    const bucket = byDrafter[meta.draftTeamId];
    bucket.wins += row.wins;
    bucket.losses += row.losses;
    bucket.ties += row.ties;
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
