/* ============================================================
   LIVE DATA: TheSportsDB v1 API
   Using the public free test key "123" — rate-limited to 30
   requests/min. Each team's data is cached in memory after its
   first fetch and refreshed on a staggered background schedule
   (see bottom of file) rather than re-fetched on every click, so
   opening a team you've already viewed this session is instant.
   If you upgrade to a premium key later (thesportsdb.com,
   ~$9/mo), just swap the "123" below for your own key.
   ============================================================ */
const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123/';
const ACHIEVEMENTS_KEY = 'teamDashboardAchievements';
const LEAGUE_FACTS_KEY = 'teamDashboardLeagueFacts';
const EPL_FACTS_MIGRATED_KEY = 'teamDashboardEplFactsMigrated';

/* ============================================================
   DASHBOARD WORKER: shared Cloudflare Worker — see
   worker/rundown-proxy.js for the two things it does:

   1. Proxies a handful of TheRundown requests (its API key can't be
      embedded in client JS the way TheSportsDB's public test key
      can). Used here purely for a console-only data-quality
      comparison against TheSportsDB — touches nothing else in the
      app.
   2. Stores the League Facts data (see below) in Workers KV so a
      mark made by one drafter is visible to everyone, instead of
      sitting in just their own browser's localStorage.

   Leave DASHBOARD_WORKER_BASE empty to turn both off — the Rundown
   comparison becomes a no-op and League Facts falls back to
   localStorage-only (not shared, but still functional).
   ============================================================ */
const DASHBOARD_WORKER_BASE = 'https://team-dashboard-rundown-proxy.boxscore.workers.dev';
const RUNDOWN_EPL_SPORT_ID = 11;

async function fetchRundownComparison(){
  if(!DASHBOARD_WORKER_BASE) return;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/events/${RUNDOWN_EPL_SPORT_ID}/${today}`);
    console.log('[TheRundown comparison] EPL events for', today, data);
  } catch(err) {
    console.warn('[TheRundown comparison] fetch failed', err);
  }
}

// Bump this on every deploy that changes what's on screen. It's shown
// in the corner of the app (see #build-tag in index.html) so you can
// confirm a device is actually running the latest build rather than
// a stale cached copy — compare what's on screen to the version
// mentioned when a change ships.
const APP_VERSION = '2026.09.10-6';

// ---- Draft team selection ----
// Which drafter's roster is currently shown on the Board/Standings
// views. Persisted in localStorage so a reload stays on the same
// person. (A URL-shareable version of this is planned separately.)
const CURRENT_DRAFT_TEAM_KEY = 'teamDashboardCurrentDraftTeam';

function loadCurrentDraftTeam(){
  try {
    const saved = localStorage.getItem(CURRENT_DRAFT_TEAM_KEY);
    if(saved && DRAFT_TEAMS.some(d => d.id === saved)) return saved;
  } catch (e){}
  return DRAFT_TEAMS[0].id;
}

let currentDraftTeamId = loadCurrentDraftTeam();

function teamsForCurrentDraftTeam(league){
  return league.teams.filter(teamKey => TEAM_META[teamKey].draftTeamId === currentDraftTeamId);
}

function setDraftTeam(id){
  if(!DRAFT_TEAMS.some(d => d.id === id)) return;
  currentDraftTeamId = id;
  try { localStorage.setItem(CURRENT_DRAFT_TEAM_KEY, id); } catch (e){}
  renderBoard();
  const standingsView = document.getElementById('view-standings');
  if(standingsView && standingsView.classList.contains('active')) renderStandings();
}

function renderDraftTeamPicker(){
  const el = document.getElementById('draft-team-picker');
  if(!el) return;
  el.innerHTML = DRAFT_TEAMS.map(d => `<option value="${d.id}" ${d.id === currentDraftTeamId ? 'selected' : ''}>${d.name}</option>`).join('');
}

// ---- Board rendering ----

function renderBoard(){
  const chipsEl = document.getElementById('filter-chips');
  const leaguesEl = document.getElementById('leagues');
  let totalTeams = 0;

  renderDraftTeamPicker();

  chipsEl.innerHTML = LEAGUES.map(l => `<div class="filter-chip" onclick="scrollToLeague('${l.key}')">${l.label}</div>`).join('');

  leaguesEl.innerHTML = LEAGUES.map(league => {
    const leagueTeams = teamsForCurrentDraftTeam(league);
    totalTeams += leagueTeams.length;
    const teamsHtml = leagueTeams.map(teamKey => {
      const meta = TEAM_META[teamKey];
      return `
        <div class="team clickable" onclick="openTeamModal('${teamKey}')">
          <div class="badge" style="${meta.badgeStyle}">${meta.badgeText}</div>
          <div class="team-main">
            <div class="team-name">${meta.name}</div>
            <div class="team-sub">${meta.boardSub}</div>
          </div>
          <div class="row-status" id="row-status-${teamKey}"></div>
        </div>
      `;
    }).join('');

    return `
      <div class="league" id="league-${league.key}">
        <div class="league-tab">
          <div class="league-tab-left">${league.label} <div class="scoring-chip" onclick="openLeagueModal('${league.key}')">Scoring</div></div>
          <span class="n">${league.season}</span>
        </div>
        ${teamsHtml}
      </div>
    `;
  }).join('');

  document.getElementById('team-tally').textContent = `${totalTeams} teams · ${LEAGUES.length} leagues`;
}

const CLOSE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6L18 18"></path><path d="M18 6L6 18"></path></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#0A0B0D" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>';

function scrollToLeague(key){
  const el = document.getElementById('league-' + key);
  if(el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---- Modal scroll lock ----
// Pins the page in place behind the modal (rather than just hiding
// overflow) so iOS Safari can't rubber-band-scroll the background
// while a modal is open. Restores the exact scroll position on close.
let lockedScrollY = 0;

function lockBodyScroll(){
  lockedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.width = '100%';
}

function unlockBodyScroll(){
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, lockedScrollY);
}

// ---- League scoring reference modal ----

function openLeagueModal(leagueKey){
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

// ---- Season tracker (manual achievement checklist -> standings) ----

function loadAchievements(){
  try {
    return JSON.parse(localStorage.getItem(ACHIEVEMENTS_KEY)) || {};
  } catch (e){
    return {};
  }
}

function saveAchievements(data){
  try {
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(data));
  } catch (e){
    // localStorage unavailable (private browsing, etc.) — achievements just won't persist.
  }
}

function isAchieved(teamKey, label){
  const all = loadAchievements();
  return !!(all[teamKey] && all[teamKey].includes(label));
}

// ---- League Facts (EPL) ----
// EPL has moved off the per-team checklist above: instead of marking
// "Relegation" on Liverpool's own tracker, you mark the real-world fact
// once — "who got relegated" — from the Results modal, and every
// drafter who owns one of those clubs is credited automatically. Rank
// rules (rankAuto in LEAGUE_SCORING.epl) skip marking entirely and are
// read straight off the live standings table once it loads.
//
// Manually-marked facts are shared across everyone looking at the
// dashboard, not just saved in your own browser — they're held in
// Workers KV behind the same Cloudflare Worker used for the TheRundown
// comparison (see DASHBOARD_WORKER_BASE / worker/rundown-proxy.js).
// localStorage (LEAGUE_FACTS_KEY) is kept alongside as a fallback: it's
// what renders instantly before the network responds, and what's used
// if DASHBOARD_WORKER_BASE is empty or unreachable.
//
// Storage shape: { [ruleLabel]: [teamKey, ...] } — only 'epl' uses this;
// every other league still uses the per-team ACHIEVEMENTS_KEY checklist
// below.

const eplFactsCache = { data: null, loading: false, error: false };

function loadLocalEplFacts(){
  try {
    const parsed = JSON.parse(localStorage.getItem(LEAGUE_FACTS_KEY));
    if(!parsed) return {};
    // Earlier versions of this feature stored { epl: {...} } (facts
    // nested per league, in case other leagues moved to this model
    // too). Unwrap that shape if we find it; otherwise this is already
    // the flat rule-map saveLocalEplFacts writes today.
    return (parsed.epl && typeof parsed.epl === 'object') ? parsed.epl : parsed;
  } catch (e){
    return {};
  }
}

function saveLocalEplFacts(epl){
  try {
    localStorage.setItem(LEAGUE_FACTS_KEY, JSON.stringify(epl));
  } catch (e){
    // localStorage unavailable (private browsing, etc.) — facts just won't persist locally.
  }
}

// Synchronous read used everywhere the app needs "what's marked right
// now": the shared copy once it's loaded, the local fallback until
// then. Kicks off the network fetch on first read, same lazy-load
// pattern as fetchEplStandingsTable.
function currentEplFacts(){
  if(eplFactsCache.data === null && !eplFactsCache.loading && !eplFactsCache.error) fetchEplFacts();
  return eplFactsCache.data || loadLocalEplFacts();
}

async function fetchEplFacts(){
  if(eplFactsCache.data !== null || eplFactsCache.loading || !DASHBOARD_WORKER_BASE) return;
  eplFactsCache.loading = true;
  const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/facts/epl`);
  eplFactsCache.loading = false;
  // If a mark was made locally while this was in flight, eplFactsCache.data
  // is no longer null — don't clobber that edit with the (now stale) GET.
  if(eplFactsCache.data !== null) return;
  if(data && typeof data === 'object'){
    eplFactsCache.data = data;
    renderStandings();
    renderEplResultsModal();
  } else {
    eplFactsCache.error = true;
  }
}

// Pushes the current facts to both the local fallback and the shared
// store. The PUT is fire-and-forget — if it fails (offline, worker
// down) the mark still sticks locally, it just won't show up for
// anyone else until the next successful sync.
function persistEplFacts(epl){
  saveLocalEplFacts(epl);
  if(!DASHBOARD_WORKER_BASE) return;
  fetch(`${DASHBOARD_WORKER_BASE}/facts/epl`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(epl)
  }).catch(err => console.warn('[League Facts] failed to sync to shared store', err));
}

// One-time migration so anyone who'd already ticked EPL boxes under the
// old per-team checklist doesn't see their marks vanish. Safe to run
// every load — it no-ops once EPL_FACTS_MIGRATED_KEY is set. Only
// touches the local fallback; if this browser ever calls
// addEplLeagueFact/removeEplLeagueFact afterward, that push syncs
// these forward to the shared store like any other edit.
function migrateEplAchievementsToFacts(){
  try {
    if(localStorage.getItem(EPL_FACTS_MIGRATED_KEY)) return;
  } catch (e){ return; }

  const oldData = loadAchievements();
  const epl = loadLocalEplFacts();

  Object.keys(oldData).forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    if(!meta || meta.leagueKey !== 'epl') return;
    (oldData[teamKey] || []).forEach(label => {
      const list = epl[label] || (epl[label] = []);
      if(!list.includes(teamKey)) list.push(teamKey);
    });
  });

  saveLocalEplFacts(epl);
  try { localStorage.setItem(EPL_FACTS_MIGRATED_KEY, '1'); } catch (e){}
}

function findEplRule(ruleLabel){
  return LEAGUE_SCORING.epl.rules.find(r => r.label === ruleLabel);
}

// Teams currently satisfying an EPL rule — auto-derived from the live
// table for rankAuto rules, or read from the manually-marked facts
// otherwise.
function getEplRuleTeams(rule){
  if(rule.rankAuto){
    const table = eplStandingsCache.table;
    if(!table) return [];
    const total = table.length;
    return table
      .filter(row => {
        const rank = parseInt(row.intRank, 10);
        return rule.rankAuto.bottom ? rank > total - rule.rankAuto.bottom : rank === rule.rankAuto.rank;
      })
      .map(row => findDraftedTeamByName('epl', row.strTeam))
      .filter(Boolean);
  }
  return currentEplFacts()[rule.label] || [];
}

function addEplLeagueFact(ruleLabel, teamKey){
  const rule = findEplRule(ruleLabel);
  if(!rule || rule.rankAuto || !teamKey) return;

  const epl = eplFactsCache.data || (eplFactsCache.data = currentEplFacts());
  if(rule.exclusive){
    epl[ruleLabel] = [teamKey];
  } else {
    const list = epl[ruleLabel] || (epl[ruleLabel] = []);
    if(!list.includes(teamKey)) list.push(teamKey);
  }
  persistEplFacts(epl);
  renderEplResultsModal();
}

function removeEplLeagueFact(ruleLabel, teamKey){
  const epl = eplFactsCache.data || (eplFactsCache.data = currentEplFacts());
  const list = epl[ruleLabel] || [];
  const idx = list.indexOf(teamKey);
  if(idx === -1) return;
  list.splice(idx, 1);
  persistEplFacts(epl);
  renderEplResultsModal();
}

// Refreshes the rows inside the Results modal in place, if it's the
// thing currently open — mirrors renderTrackerSection's guard so a
// stray fact edit can't repaint over whatever the user has since
// navigated to.
function renderEplResultsModal(){
  const modalContent = document.getElementById('modal-content');
  if(!modalContent || modalContent.dataset.activeLeagueResults !== 'epl') return;
  const league = LEAGUES.find(l => l.key === 'epl');
  const rowsHtml = LEAGUE_SCORING.epl.rules.map(r => leagueFactRowHtml(league, r)).join('');
  const list = modalContent.querySelector('.league-facts-list');
  if(list) list.innerHTML = rowsHtml;
}

function toggleAchievementByIndex(teamKey, ruleIndex){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  const rule = scoring && scoring.rules[ruleIndex];
  if(!rule) return;

  const all = loadAchievements();
  const list = all[teamKey] || [];
  const idx = list.indexOf(rule.label);
  if(idx === -1) list.push(rule.label); else list.splice(idx, 1);
  all[teamKey] = list;
  saveAchievements(all);

  renderTrackerSection(teamKey);
  const standingsView = document.getElementById('view-standings');
  if(standingsView && standingsView.classList.contains('active')) renderStandings();
}

function computeTeamPoints(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring) return 0;
  if(meta.leagueKey === 'epl'){
    return scoring.rules.reduce((sum, r) => sum + (getEplRuleTeams(r).includes(teamKey) ? r.pts : 0), 0);
  }
  const achieved = loadAchievements()[teamKey] || [];
  return scoring.rules.reduce((sum, r) => sum + (achieved.includes(r.label) ? r.pts : 0), 0);
}

function trackerSectionHtml(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring) return '';

  const total = computeTeamPoints(teamKey);

  // EPL achievements are marked from the Standings tab now (see League
  // Facts panel), not per-team — this is a read-only summary of where
  // things stand.
  if(meta.leagueKey === 'epl'){
    const itemsHtml = scoring.rules.map(r => {
      const achieved = getEplRuleTeams(r).includes(teamKey);
      return `
        <div class="tracker-item readonly ${achieved ? 'achieved' : ''}">
          <div class="tracker-check">${achieved ? CHECK_ICON_SVG : ''}</div>
          <div class="tracker-label">${r.label}</div>
          <div class="tracker-value ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts >= 0 ? '+' : ''}${r.pts} pt${Math.abs(r.pts) === 1 ? '' : 's'}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="modal-section-title">Track This Season</div>
      <div class="tracker-total">Earned so far: <b>${total >= 0 ? '+' : ''}${total}</b> pt${Math.abs(total) === 1 ? '' : 's'}</div>
      <div class="tracker-list">${itemsHtml}</div>
      <button class="tracker-manage-link" onclick="openEplResultsModal();">Marked from Results &rarr;</button>
    `;
  }

  const itemsHtml = scoring.rules.map((r, i) => {
    const achieved = isAchieved(teamKey, r.label);
    return `
      <button class="tracker-item ${achieved ? 'achieved' : ''}" onclick="toggleAchievementByIndex('${teamKey}', ${i})">
        <div class="tracker-check">${achieved ? CHECK_ICON_SVG : ''}</div>
        <div class="tracker-label">${r.label}</div>
        <div class="tracker-value ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts >= 0 ? '+' : ''}${r.pts} pt${Math.abs(r.pts) === 1 ? '' : 's'}</div>
      </button>
    `;
  }).join('');

  return `
    <div class="modal-section-title">Track This Season</div>
    <div class="tracker-total">Earned so far: <b>${total >= 0 ? '+' : ''}${total}</b> pt${Math.abs(total) === 1 ? '' : 's'}</div>
    <div class="tracker-list">${itemsHtml}</div>
  `;
}

function renderTrackerSection(teamKey){
  const el = document.getElementById('tracker-section');
  if(!el || document.getElementById('modal-content').dataset.activeTeam !== teamKey) return;
  el.innerHTML = trackerSectionHtml(teamKey);
}

// ---- League Standings: real per-league tables ----
// Only EPL is wired to live data right now — TheSportsDB's free demo
// key returns a usable (if capped) table for it. Every other league
// came back empty when tested against the free key, so those just
// show a "no data" placeholder rather than pretending to fetch.
// If this moves to a premium key later, wire the rest up the same
// way EPL is done here.
const EPL_LEAGUE_ID = '4328';
const EPL_API_SEASON = '2026-2027';
const eplStandingsCache = { table: null, error: false, loading: false };

// A few real club names don't match our shorthand roster names
// (e.g. "Man City" vs the API's "Manchester City") — normalize both
// sides before comparing so "Drafted by" still finds the right owner.
const TEAM_NAME_ALIASES = {
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'spurs': 'tottenham hotspur',
  'afc bournemouth': 'bournemouth'
};

function normalizeTeamName(name){
  let n = (name || '').toLowerCase().trim().replace(/\bafc\b/g, '').replace(/\bfc\b/g, '').replace(/\s+/g, ' ').trim();
  return TEAM_NAME_ALIASES[n] || n;
}

function findDraftedTeamByName(leagueKey, realName){
  const league = LEAGUES.find(l => l.key === leagueKey);
  if(!league) return null;
  const target = normalizeTeamName(realName);
  return league.teams.find(teamKey => {
    const candidate = normalizeTeamName(TEAM_META[teamKey].name);
    return candidate === target || target.includes(candidate) || candidate.includes(target);
  }) || null;
}

function abbrFromName(name){
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if(words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return (name || '').toUpperCase().slice(0, 3);
}

async function fetchEplStandingsTable(){
  if(eplStandingsCache.table || eplStandingsCache.loading) return;
  eplStandingsCache.loading = true;
  const data = await fetchJSON(`${API_BASE}lookuptable.php?l=${EPL_LEAGUE_ID}&s=${EPL_API_SEASON}`);
  eplStandingsCache.loading = false;
  if(data && data.table && data.table.length) eplStandingsCache.table = data.table;
  else eplStandingsCache.error = true;
  renderStandings();
}

function renderStandingsRow(leagueKey, row){
  const teamKey = findDraftedTeamByName(leagueKey, row.strTeam);
  const meta = teamKey ? TEAM_META[teamKey] : null;
  const badgeStyle = meta ? meta.badgeStyle : 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);';
  const badgeText = meta ? meta.badgeText : abbrFromName(row.strTeam);
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';

  return `
    <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
      <div class="standings-rank">${row.intRank}</div>
      <div class="badge" style="${badgeStyle}">${badgeText}</div>
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
let eplStandingsMode = 'table';

function setEplStandingsMode(mode){
  eplStandingsMode = mode;
  renderStandings();
}

function computeEplDrafterCombined(){
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

function renderEplByDrafterRow(row, rank){
  const teamsLabel = row.teamNames.join(' & ');
  let note = '';
  if(row.found === 0) note = 'No data yet';
  else if(row.found < row.total) note = `${row.found} of ${row.total} teams reporting`;

  return `
    <div class="standings-row">
      <div class="standings-rank">${row.found > 0 ? rank : '—'}</div>
      <div class="team-main">
        <div class="team-name">${row.name}</div>
        <div class="team-sub">${teamsLabel}${note ? ' &middot; ' + note : ''}</div>
      </div>
      <div class="drafted-by-chip">${row.found > 0 ? `${row.win}-${row.draw}-${row.loss} &middot; ${row.points} pts` : '&mdash;'}</div>
    </div>
  `;
}

function eplStandingsToggleHtml(){
  return `
    <div class="standings-toggle">
      <button class="toggle-btn ${eplStandingsMode === 'table' ? 'active' : ''}" onclick="setEplStandingsMode('table')">League</button>
      <button class="toggle-btn ${eplStandingsMode === 'byDrafter' ? 'active' : ''}" onclick="setEplStandingsMode('byDrafter')">Person</button>
    </div>
  `;
}

function leagueBlockHtml(league, bodyHtml){
  const resultsChipHtml = league.key === 'epl'
    ? `<div class="scoring-chip" onclick="openEplResultsModal()">Results</div>`
    : '';

  return `
    <div class="league">
      <div class="league-tab">
        <div class="league-tab-left">${league.label} <div class="scoring-chip" onclick="openLeagueModal('${league.key}')">Scoring</div>${resultsChipHtml}</div>
        <span class="n">${league.season}</span>
      </div>
      ${bodyHtml}
    </div>
  `;
}

// One place to mark league-wide facts (cup winners, who got relegated,
// etc.) instead of hunting down each drafted team individually — pick
// the real club from the dropdown and whoever drafted it gets credited.
// Rank-based rules (rankAuto) show a "Live" tag instead of a picker
// since they're read straight off the standings table above. Lives in
// its own modal (the "Results" chip) rather than inline on Standings.
function leagueFactRowHtml(league, rule){
  const selected = getEplRuleTeams(rule);
  const isAuto = !!rule.rankAuto;

  const chipsHtml = selected.length
    ? selected.map(teamKey => {
        const meta = TEAM_META[teamKey];
        const drafter = DRAFT_TEAMS.find(d => d.id === meta.draftTeamId);
        const removeBtn = isAuto ? '' : `<button class="fact-chip-x" onclick="removeEplLeagueFact('${rule.label}', '${teamKey}')" aria-label="Remove ${meta.name}">&times;</button>`;
        return `
          <span class="fact-chip">
            <span class="fact-chip-badge" style="${meta.badgeStyle}">${meta.badgeText}</span>
            ${meta.name} <span class="fact-chip-owner">${drafter.name}</span>
            ${removeBtn}
          </span>
        `;
      }).join('')
    : `<span class="fact-empty">${isAuto ? 'Pending' : 'Not marked yet'}</span>`;

  const pickerHtml = isAuto ? '' : `
    <select class="fact-picker" onchange="if(this.value){ addEplLeagueFact('${rule.label}', this.value); this.value=''; }">
      <option value="">+ Mark a team…</option>
      ${league.teams.map(teamKey => `<option value="${teamKey}">${TEAM_META[teamKey].name} — ${DRAFT_TEAMS.find(d => d.id === TEAM_META[teamKey].draftTeamId).name}</option>`).join('')}
    </select>
  `;

  return `
    <div class="fact-row">
      <div class="fact-row-top">
        <div class="fact-label">${rule.label}</div>
        ${isAuto ? '<div class="fact-auto-tag">Live</div>' : ''}
        <div class="fact-pts ${rule.pts >= 0 ? 'pos' : 'neg'}">${rule.pts >= 0 ? '+' : ''}${rule.pts}</div>
      </div>
      <div class="fact-chips">${chipsHtml}</div>
      ${pickerHtml}
    </div>
  `;
}

function openEplResultsModal(){
  const league = LEAGUES.find(l => l.key === 'epl');
  const data = LEAGUE_SCORING.epl;
  const rowsHtml = data.rules.map(r => leagueFactRowHtml(league, r)).join('');

  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = '';
  modalContent.dataset.activeLeagueResults = 'epl';

  modalContent.innerHTML = `
    <div class="modal-accent" style="background:${data.accent};"></div>
    <div class="modal-head">
      <div>
        <h2>${data.name} Results</h2>
        <div class="modal-sub">Mark who won what — credit flows to whoever drafted them</div>
      </div>
      <button class="modal-close" onclick="closeTeamModal()">${CLOSE_ICON_SVG}</button>
    </div>
    <div class="modal-body" style="padding-top: 18px;">
      <div class="league-facts-list">${rowsHtml}</div>
    </div>
  `;

  document.getElementById('modal-overlay').classList.add('open');
  lockBodyScroll();
}

function renderStandings(){
  const container = document.getElementById('standings-content');
  if(!container) return;

  const blocksHtml = LEAGUES.map(league => {
    if(league.key !== 'epl'){
      return leagueBlockHtml(league, `<div class="no-live-note">No data available.</div>`);
    }

    let bodyHtml;
    if(eplStandingsCache.table){
      const rowsHtml = eplStandingsMode === 'byDrafter'
        ? computeEplDrafterCombined().map((row, i) => renderEplByDrafterRow(row, i + 1)).join('')
        : eplStandingsCache.table.map(row => renderStandingsRow('epl', row)).join('');
      bodyHtml = eplStandingsToggleHtml() + rowsHtml;
    } else if(eplStandingsCache.error){
      bodyHtml = `<div class="no-live-note">No data available.</div>`;
    } else {
      fetchEplStandingsTable();
      bodyHtml = `<div class="loading-note">Loading standings…</div>`;
    }

    return leagueBlockHtml(league, bodyHtml);
  }).join('');

  container.innerHTML = `<div class="standings-grid">${blocksHtml}</div>`;
}

// ---- Bottom tab navigation ----

function switchView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if(view === 'standings') renderStandings();
  if(view === 'overall') renderOverallStandings();
}

// ---- Overall view: cross-drafter leaderboard ----

function computeDraftTeamBreakdown(draftTeamId){
  const perLeague = {};
  let total = 0;
  LEAGUES.forEach(league => {
    const leaguePts = league.teams.reduce((sum, teamKey) => {
      return TEAM_META[teamKey].draftTeamId === draftTeamId ? sum + computeTeamPoints(teamKey) : sum;
    }, 0);
    perLeague[league.key] = leaguePts;
    total += leaguePts;
  });
  return { perLeague, total };
}

function renderOverallStandings(){
  const container = document.getElementById('overall-content');
  if(!container) return;

  const rows = DRAFT_TEAMS.map(d => Object.assign({ id: d.id, name: d.name }, computeDraftTeamBreakdown(d.id)))
    .sort((a, b) => b.total - a.total);

  const rowsHtml = rows.map((r, i) => {
    const chipsHtml = LEAGUES.map(l => {
      const pts = r.perLeague[l.key];
      const cls = pts > 0 ? 'pos' : (pts < 0 ? 'neg' : 'zero');
      return `<span class="ob-chip ${cls}">${l.label} ${pts > 0 ? '+' : ''}${pts}</span>`;
    }).join('');

    return `
      <div class="overall-row ${r.id === currentDraftTeamId ? 'current' : ''}" onclick="setDraftTeam('${r.id}'); switchView('board');">
        <div class="overall-rank">${i + 1}</div>
        <div class="overall-main">
          <div class="overall-name">${r.name}</div>
          <div class="overall-breakdown">${chipsHtml}</div>
        </div>
        <div class="overall-total ${r.total === 0 ? 'zero' : (r.total < 0 ? 'neg' : '')}">${r.total > 0 ? '+' : ''}${r.total} pt${Math.abs(r.total) === 1 ? '' : 's'}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="overall-list">${rowsHtml}</div>`;
}

// ---- Live data: fetch, cache, render ----

const liveDataCache = {}; // teamKey -> { info, last, next, table, fetchedAt }

async function fetchJSON(url){
  try {
    const res = await fetch(url);
    if(!res.ok) return null;
    return await res.json();
  } catch (e){
    return null;
  }
}

function ordinal(n){
  n = parseInt(n, 10);
  if(isNaN(n)) return '—';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatKickoff(iso){
  if(!iso) return '';
  const d = new Date(iso.includes('Z') ? iso : iso + 'Z');
  if(isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

function formatUpdatedAt(date){
  if(!date) return '';
  // Uses the viewer's own clock, shown in Central time either way
  // (CST or CDT, whichever is actually in effect).
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' });
}

async function fetchTeamBundle(teamKey){
  const meta = TEAM_META[teamKey];
  if(!meta || !meta.sportsdbId) return null;
  const id = meta.sportsdbId;

  const [info, last, next, table] = await Promise.all([
    fetchJSON(`${API_BASE}lookupteam.php?id=${id}`),
    fetchJSON(`${API_BASE}eventslast.php?id=${id}`),
    fetchJSON(`${API_BASE}eventsnext.php?id=${id}`),
    meta.leagueId ? fetchJSON(`${API_BASE}lookuptable.php?l=${meta.leagueId}&s=${meta.season}`) : Promise.resolve(null)
  ]);

  const bundle = { info, last, next, table, fetchedAt: new Date() };
  liveDataCache[teamKey] = bundle;
  return bundle;
}

function renderStats(id, bundle){
  const el = document.getElementById('live-stats');
  if(!el) return;

  const row = bundle.table && bundle.table.table ? bundle.table.table.find(r => r.idTeam === id) : null;
  if(row){
    el.innerHTML = `
      <div class="stat-cell"><div class="num">${ordinal(row.intRank)}</div><div class="lbl">Position</div></div>
      <div class="stat-cell"><div class="num">${row.intPoints}</div><div class="lbl">Points</div></div>
      <div class="stat-cell"><div class="num">${row.intWin}-${row.intDraw}-${row.intLoss}</div><div class="lbl">W-D-L</div></div>
    `;
    return;
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

  el.innerHTML = `<div class="stat-cell" style="flex:1;"><div class="lbl">Live stats unavailable right now</div></div>`;
}

function renderForm(id, bundle){
  const el = document.getElementById('live-form');
  if(!el) return;

  const evt = bundle.last && bundle.last.results && bundle.last.results[0];
  if(!evt){
    el.innerHTML = `<div class="loading-note">No recent result found.</div>`;
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

function renderNext(id, bundle){
  const el = document.getElementById('live-next');
  if(!el) return;

  const evt = bundle.next && bundle.next.events && bundle.next.events[0];
  if(!evt){
    el.innerHTML = `<div class="loading-note">No upcoming match scheduled yet.</div>`;
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

// Board-row pill: reuses whatever the modal fetch already pulled
// (last result / next fixture) rather than fetching anything extra,
// so it stays inside the same 30 req/min budget described above.
function renderRowStatus(teamKey, bundle){
  const el = document.getElementById('row-status-' + teamKey);
  if(!el) return;
  const meta = TEAM_META[teamKey];
  const id = meta.sportsdbId;

  const nextEvt = bundle.next && bundle.next.events && bundle.next.events[0];
  if(nextEvt && nextEvt.strTimestamp){
    const d = new Date(nextEvt.strTimestamp.includes('Z') ? nextEvt.strTimestamp : nextEvt.strTimestamp + 'Z');
    if(!isNaN(d.getTime()) && d.toDateString() === new Date().toDateString()){
      el.textContent = 'Today ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      el.className = 'row-status next';
      return;
    }
  }

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

  el.textContent = '';
  el.className = 'row-status';
}

function renderLiveBundle(teamKey, bundle){
  const meta = TEAM_META[teamKey];
  if(!meta || !bundle) return;
  renderStats(meta.sportsdbId, bundle);
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

function openTeamModal(teamKey){
  const meta = TEAM_META[teamKey];
  if(!meta) return;

  document.getElementById('modal-overlay').classList.add('open');
  lockBodyScroll();

  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = teamKey;
  modalContent.dataset.activeLeagueResults = '';

  const hasLive = !!meta.sportsdbId;
  const cached = hasLive ? liveDataCache[teamKey] : null;
  const tracker = trackerSectionHtml(teamKey);

  modalContent.innerHTML = `
    <div class="modal-accent" style="background:${meta.accent};"></div>
    <div class="modal-head">
      <div class="badge" style="${meta.badgeStyle}">${meta.badgeText}</div>
      <div>
        <h2>${meta.name}</h2>
        <div class="modal-sub">${meta.sub}${hasLive ? ' <span class="live-badge">LIVE</span>' : ''}</div>
      </div>
      <button class="modal-close" onclick="closeTeamModal()">&times;</button>
    </div>
    ${hasLive ? `
      <div class="stat-strip" id="live-stats">${cached ? '' : '<div class="stat-cell" style="flex:1;"><div class="lbl">Loading…</div></div>'}</div>
      <div class="modal-body">
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

function closeTeamModal(){
  document.getElementById('modal-overlay').classList.remove('open');
  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = '';
  modalContent.dataset.activeLeagueResults = '';
  unlockBodyScroll();
}

document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') closeTeamModal();
});

/* ---- Staggered background refresh ----
   Refreshing all 18 live teams at once every few minutes would
   burst 50-70 requests in a single second. Instead we refresh one
   team at a time on a rotating schedule, so the whole board cycles
   through a refresh roughly every 15 minutes while only ever
   sending a handful of requests per minute. Every tick also paints
   that team's board-row pill (last result / today's fixture) from
   the same fetch — no extra requests are made for that. If a
   team's modal happens to be open when its turn comes up, it
   updates live and the "Last updated" time ticks forward right in
   front of you. */
const LIVE_TEAM_KEYS = Object.keys(TEAM_META).filter(k => TEAM_META[k].sportsdbId);
const REFRESH_CYCLE_MS = 15 * 60 * 1000;
const REFRESH_STEP_MS = LIVE_TEAM_KEYS.length ? REFRESH_CYCLE_MS / LIVE_TEAM_KEYS.length : REFRESH_CYCLE_MS;
let refreshCursor = 0;

async function backgroundRefreshTick(){
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

// ---- Boot ----

const buildTagEl = document.getElementById('build-tag');
if(buildTagEl) buildTagEl.textContent = APP_VERSION;

migrateEplAchievementsToFacts();
renderBoard();
backgroundRefreshTick();
setInterval(backgroundRefreshTick, REFRESH_STEP_MS);
fetchRundownComparison();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
