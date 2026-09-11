/* ============================================================
   Board rendering, the drafter picker, tab navigation, URL state,
   and the Standings-tab orchestration that ties the EPL/CFB modules
   together. Also the app's boot sequence — this is the last script
   loaded, so it runs after every other module has registered its
   window.* entry points for the inline onclick handlers in the
   rendered HTML.
   ============================================================ */
import { DRAFT_TEAMS, TEAM_META, LEAGUES, LEAGUE_SCORING } from './data.js';
import { updateUrlParam, lockBodyScroll, CLOSE_ICON_SVG, teamBadgeHtml } from './utils.js';
import { LEAGUE_FACTS_LEAGUES, migrateAchievementsToFacts } from './league-facts.js';
import { UPCOMING_CHIP_LEAGUES } from './api.js';
import {
  eplStandingsCache, eplStandingsMode, computeEplDrafterCombined, renderEplByDrafterRow,
  renderStandingsRow, eplStandingsToggleHtml, fetchEplStandingsTable, loadEplStandingsCache,
  renderAllEplCardRecords
} from './standings-epl.js';
import {
  cfbRecordsCache, cfbStandingsMode, computeCfbDrafterCombined, renderCfbByDrafterRow,
  computeCfbRankingTable, renderCfbRankingRow, cfbStandingsToggleHtml, fetchCfbRecords,
  loadCfbRecordsCache, renderAllCfbCardRecords,
  espnCfbRankingsCache, fetchEspnCfbRankingsCached, loadEspnCfbRankingsCache
} from './standings-cfb.js';
import {
  nflStandingsMode, computeNflDrafterCombined, renderNflByDrafterRow,
  computeNflConferenceStandings, renderNflStandingsRow, renderNflGroupHeader, nflStandingsToggleHtml,
  renderAllNflCardRecords, espnNflStandingsCache, fetchEspnNflStandingsCached, loadEspnNflStandingsCache
} from './standings-nfl.js';
import { renderOverallStandings, setObMode } from './overall.js';
import { loadLiveDataCache, loadTeamInfoCache, renderRowStatus, backgroundRefreshTick, REFRESH_STEP_MS, liveDataCache } from './live-data.js';

// Bump this on every deploy that changes what's on screen. It's shown
// in the corner of the app (see #build-tag in index.html) so you can
// confirm a device is actually running the latest build rather than
// a stale cached copy — compare what's on screen to the version
// mentioned when a change ships.
const APP_VERSION = '2026.09.11-4';

// ---- Bookmarkable state ----
// Reads whatever the URL specifies at load and applies it through the
// same setters a person clicking around would trigger, so this is the
// only place that needs to know the param names. ?league= or ?data=
// alone (no explicit ?view=) also switches to the tab that param
// belongs to — bookmarking "CFB standings" should land on Standings,
// not silently filter a tab you're not looking at.
function applyUrlState(){
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (e){ return; }

  const team = params.get('team');
  if(team && DRAFT_TEAMS.some(d => d.id === team)) setDraftTeam(team);

  const league = params.get('league');
  const hasLeague = !!league && (league === 'all' || LEAGUES.some(l => l.key === league));
  if(hasLeague) setStandingsFilter(league);

  const data = params.get('data');
  const hasData = data === 'real' || data === 'simulated';
  if(hasData) setObMode(data);

  const explicitView = params.get('view');
  const view = (explicitView === 'board' || explicitView === 'standings' || explicitView === 'overall')
    ? explicitView
    : (hasLeague ? 'standings' : (hasData ? 'overall' : null));
  if(view) switchView(view);
}

// ---- Draft team selection ----
// Which drafter's roster is currently shown on the Board/Standings
// views. Persisted in localStorage so a reload stays on the same
// person, and mirrored into the URL's ?team= param (see applyUrlState
// above) so it's also bookmarkable/shareable across browsers/devices.
const CURRENT_DRAFT_TEAM_KEY = 'teamDashboardCurrentDraftTeam';

function loadCurrentDraftTeam(){
  try {
    const saved = localStorage.getItem(CURRENT_DRAFT_TEAM_KEY);
    if(saved && DRAFT_TEAMS.some(d => d.id === saved)) return saved;
  } catch (e){}
  return DRAFT_TEAMS[0].id;
}

export let currentDraftTeamId = loadCurrentDraftTeam();

function teamsForCurrentDraftTeam(league){
  return league.teams.filter(teamKey => TEAM_META[teamKey].draftTeamId === currentDraftTeamId);
}

export function setDraftTeam(id){
  if(!DRAFT_TEAMS.some(d => d.id === id)) return;
  currentDraftTeamId = id;
  try { localStorage.setItem(CURRENT_DRAFT_TEAM_KEY, id); } catch (e){}
  updateUrlParam('team', id);
  renderBoard();
  const standingsView = document.getElementById('view-standings');
  if(standingsView && standingsView.classList.contains('active')) renderStandings();
}
window.setDraftTeam = setDraftTeam;

function renderDraftTeamPicker(){
  const el = document.getElementById('draft-team-picker');
  if(!el) return;
  el.innerHTML = DRAFT_TEAMS.map(d => `<option value="${d.id}" ${d.id === currentDraftTeamId ? 'selected' : ''}>${d.name}</option>`).join('');
}

// ---- Board rendering ----

export function renderBoard(){
  const chipsEl = document.getElementById('filter-chips');
  const leaguesEl = document.getElementById('leagues');
  let totalTeams = 0;

  renderDraftTeamPicker();

  chipsEl.innerHTML = LEAGUES.map(l => `<div class="filter-chip" onclick="scrollToLeague('${l.key}')">${FILTER_CHIP_LABELS[l.key] || l.label}</div>`).join('');

  leaguesEl.innerHTML = LEAGUES.map(league => {
    const leagueTeams = teamsForCurrentDraftTeam(league);
    totalTeams += leagueTeams.length;
    const teamsHtml = leagueTeams.map(teamKey => {
      const meta = TEAM_META[teamKey];
      const cfbRecordHtml = league.key === 'cfb' ? `<span class="cfb-record" id="cfb-record-${teamKey}"></span>` : '';
      const nflRecordHtml = league.key === 'nfl' ? `<span class="cfb-record" id="nfl-record-${teamKey}"></span>` : '';
      // EPL: every team is in the same one league, so the static
      // "Premier League" boardSub text carried no information — swap
      // it for the team's own record + table position instead (see
      // eplRecordLabel/renderEplCardRecord in js/standings-epl.js).
      // CFB/NFL boardSub (mascot/city) is still meaningful per team, so
      // those keep it and just append their record chip after it.
      const subHtml = league.key === 'epl'
        ? `<span class="epl-record" id="epl-record-${teamKey}"></span>`
        : `${meta.boardSub}${cfbRecordHtml}${nflRecordHtml}`;
      return `
        <div class="team clickable" onclick="openTeamModal('${teamKey}')">
          ${teamBadgeHtml(meta)}
          <div class="team-main">
            <div class="team-name">${meta.name}</div>
            <div class="team-sub">${subHtml}</div>
          </div>
          <div class="row-status" id="row-status-${teamKey}"></div>
        </div>
      `;
    }).join('');

    return `
      <div class="league" id="league-${league.key}">
        <div class="league-tab board-league-tab">
          <div class="league-tab-left">
            <div>${LEAGUE_FULL_LABELS[league.key] || league.label}</div>
            <span class="n">${league.season}</span>
          </div>
          <span class="n">${UPCOMING_CHIP_LEAGUES.includes(league.key) ? 'Upcoming' : 'Last Result'}</span>
        </div>
        ${teamsHtml}
      </div>
    `;
  }).join('');

  document.getElementById('team-tally').textContent = `${totalTeams} teams · ${LEAGUES.length} leagues`;

  // The team rows above were just rebuilt from scratch, so every
  // row-status pill and CFB/EPL record chip starts blank again —
  // repaint them from whatever's already cached (same as the boot
  // sequence below) rather than leaving this drafter's roster blank
  // until the staggered background refresh or the standings TTLs
  // happen to reach it.
  for(const teamKey of Object.keys(liveDataCache)){
    if(TEAM_META[teamKey]) renderRowStatus(teamKey, liveDataCache[teamKey]);
  }
  renderAllCfbCardRecords();
  renderAllEplCardRecords();
  renderAllNflCardRecords();
}

export function scrollToLeague(key){
  const el = document.getElementById('league-' + key);
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.scrollToLeague = scrollToLeague;

// ---- League scoring reference modal ----

export function openLeagueModal(leagueKey){
  const data = LEAGUE_SCORING[leagueKey];
  if(!data) return;

  const rulesHtml = data.rules.map(r => `
    <div class="scoring-item">
      <div class="scoring-label">${r.label}</div>
      <div class="scoring-value ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts >= 0 ? '+' : ''}${r.pts} pt${Math.abs(r.pts) === 1 ? '' : 's'}</div>
    </div>
  `).join('');

  // The league bonus is awarded once per drafter (not per team), so it's
  // kept separate from `rules` — it never appears as a checkable item on
  // an individual team's tracker.
  const bonusHtml = data.bonus ? `
    <div class="modal-section-title" style="margin-top: 18px;">League Bonus</div>
    <div class="scoring-list">
      <div class="scoring-item">
        <div class="scoring-label">${data.bonus.label}</div>
        <div class="scoring-value pos">+${data.bonus.pts} pts</div>
      </div>
    </div>
  ` : '';

  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = '';
  modalContent.dataset.activeLeagueResults = '';

  modalContent.innerHTML = `
    <div class="modal-accent" style="background:${data.accent};"></div>
    <div class="modal-head">
      <div>
        <h2>${data.name}</h2>
        <div class="modal-sub">${data.full}</div>
      </div>
      <button class="modal-close" onclick="closeTeamModal()">${CLOSE_ICON_SVG}</button>
    </div>
    <div class="modal-body" style="padding-top: 18px;">
      <div class="scoring-list">${rulesHtml}</div>
      ${bonusHtml}
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
  lockBodyScroll();
}
window.openLeagueModal = openLeagueModal;

// Spelled out in both the Teams tab's section headers and the
// Standings header — the filter chips and modal titles still keep the
// short LEAGUES[].label as-is (see FILTER_CHIP_LABELS below).
const LEAGUE_FULL_LABELS = {
  epl: 'English Premier League',
  cfb: 'College Football',
  mcbb: "Men's College Basketball"
};

// Shortened further still for the filter chip row only — the Teams
// tab's league jump-to chips and the Standings tab's league filter
// chips. Every other use of a league's label (Board section headers,
// the Standings header above, modal titles) keeps LEAGUES[].label.
const FILTER_CHIP_LABELS = {
  cfb: 'CFB',
  mcbb: 'CBB'
};

function leagueBlockHtml(league, bodyHtml){
  const resultsChipHtml = LEAGUE_FACTS_LEAGUES.includes(league.key)
    ? `<div class="scoring-chip" onclick="openLeagueResultsModal('${league.key}')">Results</div>`
    : '';
  const headerLabel = LEAGUE_FULL_LABELS[league.key] || league.label;

  return `
    <div class="league">
      <div class="league-tab standings-league-tab">
        <div class="league-tab-top">
          <div class="league-tab-left">${headerLabel}</div>
          <span class="n">${league.season}</span>
        </div>
        <div class="league-tab-chips">
          <div class="scoring-chip" onclick="openLeagueModal('${league.key}')">Scoring</div>
          ${resultsChipHtml}
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;
}

// Which league the Standings view is isolated to — like eplStandingsMode
// in js/standings-epl.js, this isn't persisted to localStorage, so it
// resets to "All" each time you open the app with no URL state of its
// own. It IS mirrored into ?league= (see applyUrlState) so a specific
// league's Standings view is still bookmarkable/shareable, just not
// "sticky" the way the drafter picker is.
let standingsFilterKey = 'all';

export function setStandingsFilter(key){
  standingsFilterKey = key;
  updateUrlParam('league', key === 'all' ? null : key);
  renderStandings();
}
window.setStandingsFilter = setStandingsFilter;

export function renderStandings(){
  const container = document.getElementById('standings-content');
  if(!container) return;

  const chipsHtml = ['all'].concat(LEAGUES.map(l => l.key)).map(key => {
    const label = key === 'all' ? 'All' : (FILTER_CHIP_LABELS[key] || LEAGUES.find(l => l.key === key).label);
    return `<div class="filter-chip ${key === standingsFilterKey ? 'active' : ''}" onclick="setStandingsFilter('${key}')">${label}</div>`;
  }).join('');

  const shownLeagues = standingsFilterKey === 'all' ? LEAGUES : LEAGUES.filter(l => l.key === standingsFilterKey);

  const blocksHtml = shownLeagues.map(league => {
    if(league.key === 'epl'){
      let bodyHtml;
      if(eplStandingsCache.table){
        const rowsHtml = eplStandingsMode === 'byDrafter'
          ? computeEplDrafterCombined().map((row, i) => renderEplByDrafterRow(row, i + 1)).join('')
          : eplStandingsCache.table.map(row => renderStandingsRow('epl', row)).join('');
        bodyHtml = eplStandingsToggleHtml() + rowsHtml;
        fetchEplStandingsTable(); // no-op if already fresh; quietly refreshes in the background if stale
      } else if(eplStandingsCache.error){
        bodyHtml = `<div class="no-live-note">No data available.</div>`;
      } else {
        fetchEplStandingsTable();
        bodyHtml = `<div class="loading-note">Loading standings…</div>`;
      }
      return leagueBlockHtml(league, bodyHtml);
    }

    if(league.key === 'cfb'){
      // Each mode now has its own data source — the AP Top 25 moved to
      // ESPN (no more TheRundown dependency, see js/standings-cfb.js's
      // header comment), while "Person" (combined win%) still reads
      // TheRundown's records — so each is gated on its own cache rather
      // than the one shared check this used before.
      let bodyHtml;
      if(cfbStandingsMode === 'byDrafter'){
        if(cfbRecordsCache.byTeamId){
          const rowsHtml = computeCfbDrafterCombined().map((row, i) => renderCfbByDrafterRow(row, i + 1)).join('');
          bodyHtml = cfbStandingsToggleHtml() + rowsHtml;
          fetchCfbRecords(); // no-op if already fresh; quietly refreshes in the background if stale
        } else if(cfbRecordsCache.error){
          bodyHtml = `<div class="no-live-note">No data available.</div>`;
        } else {
          fetchCfbRecords();
          bodyHtml = `<div class="loading-note">Loading standings…</div>`;
        }
      } else {
        if(espnCfbRankingsCache.ranks){
          const rankingRows = computeCfbRankingTable();
          const rowsHtml = rankingRows.length
            ? rankingRows.map(rank => renderCfbRankingRow(rank)).join('')
            : `<div class="no-live-note">No teams currently ranked.</div>`;
          bodyHtml = cfbStandingsToggleHtml() + rowsHtml;
          fetchEspnCfbRankingsCached(); // no-op if already fresh; quietly refreshes in the background if stale
        } else if(espnCfbRankingsCache.error){
          bodyHtml = `<div class="no-live-note">No data available.</div>`;
        } else {
          fetchEspnCfbRankingsCached();
          bodyHtml = `<div class="loading-note">Loading standings…</div>`;
        }
      }
      return leagueBlockHtml(league, bodyHtml);
    }

    if(league.key === 'nfl'){
      // Both modes read the same espnNflStandingsCache now — unlike
      // CFB, where "Person" has to stay on TheRundown (ESPN's CFB
      // rankings only cover the Top 25, not the full roster combined
      // win% needs), ESPN's NFL standings already cover all 32 teams,
      // so there's no coverage gap keeping "Person" on a separate,
      // metered source here. See js/standings-nfl.js's header comment.
      let bodyHtml;
      if(espnNflStandingsCache.rows){
        let rowsHtml;
        if(nflStandingsMode === 'byDrafter'){
          rowsHtml = computeNflDrafterCombined().map((row, i) => renderNflByDrafterRow(row, i + 1)).join('');
        } else {
          const conferences = computeNflConferenceStandings();
          rowsHtml = conferences.length
            ? conferences.map(conf =>
                renderNflGroupHeader(conf.name) + conf.teams.map((t, i) => renderNflStandingsRow(t, i + 1)).join('')
              ).join('')
            : `<div class="no-live-note">No teams currently reporting.</div>`;
        }
        bodyHtml = nflStandingsToggleHtml() + rowsHtml;
        fetchEspnNflStandingsCached(); // no-op if already fresh; quietly refreshes in the background if stale
      } else if(espnNflStandingsCache.error){
        bodyHtml = `<div class="no-live-note">No data available.</div>`;
      } else {
        fetchEspnNflStandingsCached();
        bodyHtml = `<div class="loading-note">Loading standings…</div>`;
      }
      return leagueBlockHtml(league, bodyHtml);
    }

    return leagueBlockHtml(league, `<div class="no-live-note">No data available.</div>`);
  }).join('');

  container.innerHTML = `
    <div class="standings-filter-row"><div class="filter-chips">${chipsHtml}</div></div>
    <div class="standings-grid">${blocksHtml}</div>
  `;
}

// ---- Bottom tab navigation ----

export function switchView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  updateUrlParam('view', view === 'board' ? null : view);
  if(view === 'standings') renderStandings();
  if(view === 'overall') renderOverallStandings();
}
window.switchView = switchView;

// ---- Boot ----

const buildTagEl = document.getElementById('build-tag');
if(buildTagEl) buildTagEl.textContent = APP_VERSION;

LEAGUE_FACTS_LEAGUES.forEach(migrateAchievementsToFacts);
loadLiveDataCache();
loadEplStandingsCache();
loadCfbRecordsCache();
loadEspnCfbRankingsCache();
loadEspnNflStandingsCache();
loadTeamInfoCache();
renderBoard();
applyUrlState();

// renderBoard() already repaints row-status pills and CFB/EPL/NFL
// record chips from whatever's cached (possibly from a previous
// browser session), so nothing sits blank waiting for its turn in the
// staggered refresh below. Still need to kick off the actual records
// fetches here, regardless of whether the Standings tab (the only
// other place that calls these) has been opened yet, so the board's
// records aren't stuck waiting on that.
fetchCfbRecords();
fetchEplStandingsTable();
fetchEspnNflStandingsCached();

backgroundRefreshTick();
setInterval(backgroundRefreshTick, REFRESH_STEP_MS);

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
