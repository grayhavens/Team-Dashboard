/* ============================================================
   LIVE DATA: TheSportsDB v1 API
   Using the public free test key "123" — rate-limited to 30
   requests/min. Each team's data is cached in memory (and mirrored to
   localStorage — see LIVE_DATA_CACHE_KEY below) after its first
   fetch and refreshed on a staggered background schedule (see bottom
   of file) rather than re-fetched on every click, so opening a team
   you've already viewed is instant, even across browser sessions.
   If you upgrade to a premium key later (thesportsdb.com,
   ~$9/mo), just swap the "123" below for your own key.
   ============================================================ */
const API_BASE = 'https://www.thesportsdb.com/api/v1/json/123/';
const ACHIEVEMENTS_KEY = 'teamDashboardAchievements';
const LEAGUE_FACTS_KEY = 'teamDashboardLeagueFacts';
const EPL_FACTS_MIGRATED_KEY = 'teamDashboardEplFactsMigrated';
const LIVE_DATA_CACHE_KEY = 'teamDashboardLiveDataCache';

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
   2. Stores the League Facts data (see below) in Workers KV so a
      mark made by one drafter is visible to everyone, instead of
      sitting in just their own browser's localStorage.

   Leave DASHBOARD_WORKER_BASE empty to turn both off — the
   TheRundown lookups become a no-op (teams fall back to their
   existing TheSportsDB-only display) and League Facts falls back to
   localStorage-only (not shared, but still functional).
   ============================================================ */
const DASHBOARD_WORKER_BASE = 'https://team-dashboard-rundown-proxy.boxscore.workers.dev';

// Which TheRundown sport_id each leagueKey maps to. Only leagues
// listed here get the live in-game-state supplement — add a league
// only after its rundownTeamId mappings have been verified against
// real fixtures (see worker/rundown-proxy.js's /teams/{sportId}).
const RUNDOWN_SPORT_ID = {
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
const RUNDOWN_LIVE_STATUSES = new Set(['STATUS_IN_PROGRESS', 'STATUS_HALFTIME', 'STATUS_END_PERIOD']);

// A day's full slate for a league rarely changes within a few
// minutes, and every team in that league shares one slate — so this
// caches by leagueKey+date for a short TTL rather than re-fetching
// per team. Keeps live-score staleness bounded to ~1 minute while
// still collapsing near-simultaneous requests (e.g. a background
// tick and a modal open) into one network call.
const RUNDOWN_CACHE_TTL_MS = 60 * 1000;
const rundownDayCache = {};

async function fetchRundownDayEvents(leagueKey, dateStr){
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

function findRundownEventForTeam(dayEvents, rundownTeamId){
  if(!dayEvents || !dayEvents.events || !rundownTeamId) return null;
  return dayEvents.events.find(e => (e.teams || []).some(t => t.team_id === rundownTeamId)) || null;
}

function isRundownEventLive(event){
  return !!event && RUNDOWN_LIVE_STATUSES.has(event.score && event.score.event_status);
}

// Looks up today's TheRundown event for a team, if that team's
// league has been migrated (RUNDOWN_SPORT_ID) and has a
// rundownTeamId set. Uses the viewer's UTC date, same as TheRundown's
// day boundary — a game starting right at that boundary may show up
// a refresh cycle late, which self-corrects on the next tick.
async function fetchRundownEventForTeam(meta){
  if(!meta.rundownTeamId || !RUNDOWN_SPORT_ID[meta.leagueKey]) return null;
  const today = new Date().toISOString().slice(0, 10);
  const dayEvents = await fetchRundownDayEvents(meta.leagueKey, today);
  return findRundownEventForTeam(dayEvents, meta.rundownTeamId);
}

// Bump this on every deploy that changes what's on screen. It's shown
// in the corner of the app (see #build-tag in index.html) so you can
// confirm a device is actually running the latest build rather than
// a stale cached copy — compare what's on screen to the version
// mentioned when a change ships.
const APP_VERSION = '2026.09.10-26';

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

// Renders a team's badge: the real crest image when meta.badgeUrl is
// set, layered over the same colored-monogram box every team already
// has — that box stays as the fallback (onerror removes the img,
// revealing it) since hotlinked images can occasionally fail to load,
// and it's what every team without a badgeUrl yet still uses as-is.
function teamBadgeHtml(meta){
  if(meta.badgeUrl){
    // Real crests are transparent PNGs meant to sit on a light backdrop.
    // Putting one over the team's own accent color looked fine for most
    // teams, but broke badly for e.g. Liverpool — an all-red crest over
    // Liverpool's near-identical red background was nearly invisible.
    // White background instead, consistent regardless of a team's own
    // brand color. data-fallback-* carries the original colored-monogram
    // look over to the onerror handler, restored only if the hotlinked
    // image actually fails to load.
    return `<div class="badge badge-crest"><img src="${meta.badgeUrl}" alt="${meta.name}" data-fallback-style="${meta.badgeStyle}" data-fallback-text="${meta.badgeText}" onerror="const p=this.parentElement; p.className='badge'; p.setAttribute('style', this.dataset.fallbackStyle); p.textContent=this.dataset.fallbackText;"></div>`;
  }
  return `<div class="badge" style="${meta.badgeStyle}">${meta.badgeText}</div>`;
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
          ${teamBadgeHtml(meta)}
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
          <div class="league-tab-left">${league.label} <span class="n">${league.season}</span></div>
          <span class="n">Last Result</span>
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

// The slice of a team's points that comes from current-standings rules
// (rankAuto) rather than a real, locked-in fact — these can still move
// as the table changes before the season ends. EPL-only for now: no
// other league has a rankAuto rule yet, so this is always 0 elsewhere.
function computeTeamProvisionalPoints(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring || meta.leagueKey !== 'epl') return 0;
  return scoring.rules.reduce((sum, r) => sum + (r.rankAuto && getEplRuleTeams(r).includes(teamKey) ? r.pts : 0), 0);
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
    const provisionalPts = computeTeamProvisionalPoints(teamKey);
    const itemsHtml = scoring.rules.map(r => {
      const achieved = getEplRuleTeams(r).includes(teamKey);
      // Rank-based rules (rankAuto) reflect the table as it stands right
      // now, not a locked-in result — "2nd in EPL" today could be 5th by
      // the time the season actually ends. Give those a visibly
      // different (amber, not green/red) state instead of the same
      // checkmark used for a real fact like "Win FA Cup".
      const isProvisional = achieved && !!r.rankAuto;
      const stateClass = achieved ? (isProvisional ? 'provisional' : 'achieved') : '';
      return `
        <div class="tracker-item readonly ${stateClass}">
          <div class="tracker-check">${achieved ? CHECK_ICON_SVG : ''}</div>
          <div class="tracker-label">${r.label}${isProvisional ? '<span class="provisional-tag">Current</span>' : ''}</div>
          <div class="tracker-value ${r.pts >= 0 ? 'pos' : 'neg'}">${r.pts >= 0 ? '+' : ''}${r.pts} pt${Math.abs(r.pts) === 1 ? '' : 's'}</div>
        </div>
      `;
    }).join('');

    // "Earned so far" is confirmed points only — locked-in facts, not
    // whatever the table currently implies. Provisional points are
    // shown separately alongside it, not folded into that headline
    // number, since they can still move before the season ends.
    const confirmedPts = total - provisionalPts;
    const provisionalNoteHtml = provisionalPts !== 0
      ? `<span class="provisional-note">${provisionalPts >= 0 ? '+' : ''}${provisionalPts} provisional</span>`
      : '';

    return `
      <div class="modal-section-title">Track This Season</div>
      <div class="tracker-total">Earned so far: <b>${confirmedPts >= 0 ? '+' : ''}${confirmedPts}</b> pt${Math.abs(confirmedPts) === 1 ? '' : 's'}${provisionalNoteHtml}</div>
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
const EPL_STANDINGS_CACHE_KEY = 'teamDashboardEplStandingsCache';
// How long a fetched table is trusted before a background refresh is
// attempted again — matches the board's own ~15min refresh cadence.
// Doesn't gate *display*: a stale cached table (even one restored from
// localStorage from a previous session) is still shown immediately
// rather than blocked on a fresh fetch — same "show what we have, then
// quietly refresh" approach as the row-status pill cache.
const EPL_STANDINGS_TTL_MS = 15 * 60 * 1000;
const eplStandingsCache = { table: null, error: false, loading: false, fetchedAt: null };
let eplStandingsPromise = null;

function eplStandingsIsFresh(){
  return !!eplStandingsCache.table && !!eplStandingsCache.fetchedAt && (Date.now() - eplStandingsCache.fetchedAt) < EPL_STANDINGS_TTL_MS;
}

function saveEplStandingsCache(){
  try { localStorage.setItem(EPL_STANDINGS_CACHE_KEY, JSON.stringify(eplStandingsCache)); } catch (e){}
}

// One shared table for every EPL team — modal stats, the Standings
// tab's League/Person views, and the League Facts rank-auto rules
// (getEplRuleTeams below) all read eplStandingsCache.table directly
// rather than each fetching or storing their own copy. This is what
// keeps a growing roster of EPL teams (more drafters' clubs getting
// wired up over time) at one request instead of one per team, and
// keeps localStorage from ending up with N duplicate copies of the
// same ~20-row table.
function loadEplStandingsCache(){
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

// Callers (fetchTeamBundle for each EPL team, renderStandings) all
// await the same in-flight promise when a fetch is already running,
// instead of firing their own — this is the actual "load once" part.
function fetchEplStandingsTable(){
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

function renderStandingsRow(leagueKey, row){
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

function eplStandingsToggleHtml(){
  return `
    <div class="standings-toggle">
      <button class="toggle-btn ${eplStandingsMode === 'table' ? 'active' : ''}" onclick="setEplStandingsMode('table')">League</button>
      <button class="toggle-btn ${eplStandingsMode === 'byDrafter' ? 'active' : ''}" onclick="setEplStandingsMode('byDrafter')">Person</button>
    </div>
  `;
}

// Spelled out only in the Standings header — the filter chips, Board
// tab, and modal titles all keep the short LEAGUES[].label as-is.
const STANDINGS_HEADER_LABELS = {
  epl: 'English Premier League'
};

function leagueBlockHtml(league, bodyHtml){
  const resultsChipHtml = league.key === 'epl'
    ? `<div class="scoring-chip" onclick="openEplResultsModal()">Results</div>`
    : '';
  const headerLabel = STANDINGS_HEADER_LABELS[league.key] || league.label;

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

// Which league the Standings view is isolated to — like eplStandingsMode
// below, this is a within-session view convenience (not persisted), so
// it resets to "All" each time you open the app.
let standingsFilterKey = 'all';

function setStandingsFilter(key){
  standingsFilterKey = key;
  renderStandings();
}

function renderStandings(){
  const container = document.getElementById('standings-content');
  if(!container) return;

  const chipsHtml = ['all'].concat(LEAGUES.map(l => l.key)).map(key => {
    const label = key === 'all' ? 'All' : LEAGUES.find(l => l.key === key).label;
    return `<div class="filter-chip ${key === standingsFilterKey ? 'active' : ''}" onclick="setStandingsFilter('${key}')">${label}</div>`;
  }).join('');

  const shownLeagues = standingsFilterKey === 'all' ? LEAGUES : LEAGUES.filter(l => l.key === standingsFilterKey);

  const blocksHtml = shownLeagues.map(league => {
    if(league.key !== 'epl'){
      return leagueBlockHtml(league, `<div class="no-live-note">No data available.</div>`);
    }

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
  }).join('');

  container.innerHTML = `
    <div class="standings-filter-row"><div class="filter-chips">${chipsHtml}</div></div>
    <div class="standings-grid">${blocksHtml}</div>
  `;
}

// ---- Bottom tab navigation ----

function switchView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if(view === 'standings') renderStandings();
  if(view === 'overall') renderOverallStandings();
}

// ---- Overall view: cross-drafter leaderboard ----
//
// The LIST shows confirmed points only (locked-in facts). Provisional
// points — the rankAuto slice that still moves with the live table —
// appear only in a drafter's breakdown, never folded into the ranking
// number. See obIsProvisional below for what counts as provisional.

// League color for the mix bar / legend dots. Deliberately NOT each
// league's real modal accent (LEAGUE_SCORING[key].accent) — those are
// brand colors picked to sit on a light badge, and half of them are
// near-black (NHL, CFB, NFL, MLB) or fully-saturated neon (WNBA, NBA),
// which reads as broken/jarring on this view's near-black background:
// some segments nearly vanish, others scream. This is a separate,
// hand-tuned set at consistent medium lightness/saturation so all
// eight sit comfortably on --bg/--surface, spaced around the hue wheel
// away from the tokens this same screen already uses for meaning
// (--accent, --win, --loss, --provisional) so a league's color is
// never mistaken for "leader," "positive," "negative," or "provisional."
const OB_LEAGUE_CHART_COLOR = {
  epl: '#826AC8', cfb: '#C86AA1', nfl: '#91C86A', mcbb: '#C58C6A',
  nba: '#B57FC0', nhl: '#6FBFC6', mlb: '#6AC87A', wnba: '#A8B36A'
};

function obLeagueColor(leagueKey){
  const scoring = LEAGUE_SCORING[leagueKey];
  return OB_LEAGUE_CHART_COLOR[leagueKey] || (scoring && scoring.accent) || 'var(--text-mute)';
}

// Which row is expanded inline, and which drafter's full breakdown is
// open. Within-session view state only, same as standingsFilterKey.
let obExpandedId = null;
let obDetailId = null;

function obSignedPts(n){
  return (n > 0 ? '+' : '') + n;
}

function obPtsClass(n){
  return n > 0 ? 'pos' : (n < 0 ? 'neg' : 'zero');
}

/* ---- The two seams a new league's scoring model plugs into ----

   1. obRuleTeams(league, rule): who satisfies a rule right now.
      Today: EPL reads the shared facts + live table; every other
      league reads its per-team checklist. When another league moves
      to a facts/live model, either define a global
        getLeagueRuleTeams(leagueKey, rule) -> [teamKey, ...]
      (picked up automatically, no change here) or add a case below.

   2. obIsProvisional(rule): whether a rule's points can still move.
      Any rule carrying `rankAuto` (derived from a standings table) or
      an explicit `live: true` in LEAGUE_SCORING counts as provisional —
      league-agnostic, so tagging a new rule in js/data.js is all it
      takes for it to show up as provisional everywhere in this view.
*/

function obRuleTeams(league, rule){
  if(typeof getLeagueRuleTeams === 'function'){
    const teams = getLeagueRuleTeams(league.key, rule);
    if(Array.isArray(teams)) return teams;
  }
  if(league.key === 'epl') return getEplRuleTeams(rule);
  return league.teams.filter(teamKey => isAchieved(teamKey, rule.label));
}

function obIsProvisional(rule){
  return !!(rule.rankAuto || rule.live);
}

// Every rule currently satisfied by one of a drafter's teams, itemized.
// This is the single source for both levels of the view: per-league
// point totals and the confirmed/provisional split are summed from it
// (rather than from computeTeamPoints/computeTeamProvisionalPoints
// directly), so a rule that becomes provisional needs no other change.
// ---- TEMPORARY: Real/Simulated data preview ----
//
// The season hasn't produced enough real results to make this view
// worth showing anyone yet. "Simulated" fabricates a plausible-looking
// leaderboard from the real drafters, teams, and scoring rules — no
// fake teams or invented rules — so the page can be demoed now. Delete
// this whole block (down to "---- End temporary block ----"), the
// `obMode` branch in obDrafterAwards below, and the toggle markup in
// index.html / its CSS in style.css once real data makes it moot.

const OB_DATA_MODE_KEY = 'teamDashboardObDataMode';

function loadObMode(){
  try {
    const saved = localStorage.getItem(OB_DATA_MODE_KEY);
    return saved === 'simulated' ? 'simulated' : 'real';
  } catch (e){
    return 'real';
  }
}

let obMode = loadObMode();

function setObMode(mode){
  if(mode !== 'real' && mode !== 'simulated') return;
  obMode = mode;
  try { localStorage.setItem(OB_DATA_MODE_KEY, mode); } catch (e){}
  renderOverallStandings();
}

// Tiny seeded PRNG (xmur3 hash -> mulberry32) so the simulated
// leaderboard looks the same on every render/reload instead of
// reshuffling each time — a moving demo is harder to walk someone
// through than a stable one.
function obSeededRandom(seedStr){
  let h = 1779033703 ^ seedStr.length;
  for(let i = 0; i < seedStr.length; i++){
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  let a = h >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function obSeededShuffle(arr, rng){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Builds a fake "standings" per league (a seeded shuffle of that
// league's real teams) and cascades each league's real rules down from
// it: the highest-value rule is the most exclusive (won by a team near
// the top of the shuffle), and easier rules land on a wider band of
// teams — the same way a real playoff bracket nests. `exclusive` rules
// (only ever true for one team) go to a single team from the top of
// the order. Negative rules cascade up from the bottom the same way.
// Computed once and cached — it's deterministic, so recomputing would
// only waste cycles.
let obSimIndexCache = null;

function obSimIndex(){
  if(obSimIndexCache) return obSimIndexCache;
  const index = {};
  LEAGUES.forEach(league => {
    const scoring = LEAGUE_SCORING[league.key];
    if(!scoring) return;
    const rng = obSeededRandom('ob-sim-' + league.key);
    const order = obSeededShuffle(league.teams, rng);
    const n = order.length;
    const awards = [];

    scoring.rules.filter(r => r.pts > 0).sort((a, b) => b.pts - a.pts).forEach((rule, i) => {
      if(rule.exclusive){
        const pool = Math.max(1, Math.min(n, Math.round(n * 0.3)));
        awards.push({ teamKey: order[Math.floor(rng() * pool)], rule });
        return;
      }
      const count = Math.max(1, Math.min(n, Math.round(n * Math.min(0.85, 0.12 + i * 0.14))));
      order.slice(0, count).forEach(teamKey => awards.push({ teamKey, rule }));
    });

    scoring.rules.filter(r => r.pts < 0).sort((a, b) => a.pts - b.pts).forEach((rule, i) => {
      const count = Math.max(1, Math.min(n, Math.round(n * Math.min(0.5, 0.12 + i * 0.14))));
      order.slice(n - count).forEach(teamKey => awards.push({ teamKey, rule }));
    });

    index[league.key] = awards;
  });
  obSimIndexCache = index;
  return index;
}

function obSimDrafterAwards(draftTeamId){
  const index = obSimIndex();
  const awards = [];
  LEAGUES.forEach(league => {
    (index[league.key] || []).forEach(({ teamKey, rule }) => {
      const meta = TEAM_META[teamKey];
      if(!meta || meta.draftTeamId !== draftTeamId) return;
      awards.push({
        leagueKey: league.key,
        leagueLabel: league.label,
        teamKey,
        teamName: meta.name,
        label: rule.label,
        pts: rule.pts,
        provisional: obIsProvisional(rule)
      });
    });
  });
  return awards;
}

// ---- End temporary block ----

function obDrafterAwards(draftTeamId){
  if(obMode === 'simulated') return obSimDrafterAwards(draftTeamId);

  const awards = [];
  LEAGUES.forEach(league => {
    const scoring = LEAGUE_SCORING[league.key];
    if(!scoring) return;
    scoring.rules.forEach(rule => {
      obRuleTeams(league, rule).forEach(teamKey => {
        const meta = TEAM_META[teamKey];
        if(!meta || meta.draftTeamId !== draftTeamId) return;
        awards.push({
          leagueKey: league.key,
          leagueLabel: league.label,
          teamKey,
          teamName: meta.name,
          label: rule.label,
          pts: rule.pts,
          provisional: obIsProvisional(rule)
        });
      });
    });
  });
  return awards;
}

function obTeamNamesFor(draftTeamId, league){
  return league.teams
    .filter(teamKey => TEAM_META[teamKey] && TEAM_META[teamKey].draftTeamId === draftTeamId)
    .map(teamKey => TEAM_META[teamKey].name);
}

// One drafter's row model. The confirmed total is what ranks the board;
// provisional only ever surfaces in the breakdown.
function obBuildRow(d){
  const awards = obDrafterAwards(d.id);
  const leagues = LEAGUES.map(l => {
    const mine = awards.filter(a => a.leagueKey === l.key);
    const pts = mine.reduce((s, a) => s + a.pts, 0);
    const provisional = mine.reduce((s, a) => s + (a.provisional ? a.pts : 0), 0);
    return { league: l, pts, provisional, confirmed: pts - provisional };
  });
  const total = leagues.reduce((s, x) => s + x.pts, 0);
  const provisionalTotal = leagues.reduce((s, x) => s + x.provisional, 0);
  return {
    id: d.id,
    name: d.name,
    total,
    provisionalTotal,
    confirmedTotal: total - provisionalTotal,
    leagues,
    awards
  };
}

function obRows(){
  return DRAFT_TEAMS.map(obBuildRow)
    .sort((a, b) => b.confirmedTotal - a.confirmedTotal || a.name.localeCompare(b.name));
}

// ---- List ----

function obMixBarHtml(row){
  const positives = row.leagues.filter(x => x.confirmed > 0);
  const sum = positives.reduce((s, x) => s + x.confirmed, 0);
  if(!sum) return '<div class="ob-mix"></div>';
  const segs = positives.map(x =>
    `<span class="ob-mix-seg" style="width:${(x.confirmed / sum) * 100}%; background:${obLeagueColor(x.league.key)};" title="${x.league.label} ${obSignedPts(x.confirmed)}"></span>`
  ).join('');
  return `<div class="ob-mix">${segs}</div>`;
}

function obMixLabel(row){
  const active = row.leagues.filter(x => x.confirmed !== 0);
  if(!active.length) return 'nothing confirmed yet';
  const top = active.slice().sort((a, b) => b.confirmed - a.confirmed)[0];
  return `${active.length} of ${LEAGUES.length} leagues &middot; ${top.league.label} leads`;
}

function obExpandHtml(row){
  const leagueRowsHtml = row.leagues.map(x => {
    const maxAbs = Math.max(1, ...row.leagues.map(y => Math.abs(y.confirmed)));
    const width = (Math.abs(x.confirmed) / maxAbs) * 100;
    return `
      <div class="ob-lg-row">
        <span class="ob-lg-dot" style="background:${x.confirmed === 0 ? 'var(--hairline-strong)' : obLeagueColor(x.league.key)};"></span>
        <div class="ob-lg-label">${x.league.label}</div>
        <div class="ob-lg-track"><span style="width:${width}%; background:${obLeagueColor(x.league.key)};"></span></div>
        <div class="ob-lg-pts ${obPtsClass(x.confirmed)}">${x.confirmed === 0 ? '&mdash;' : obSignedPts(x.confirmed)}</div>
      </div>
    `;
  }).join('');

  const confirmed = row.awards.filter(a => !a.provisional)
    .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts))
    .slice(0, 3);

  const awardsHtml = confirmed.length
    ? confirmed.map(a => `
        <div class="ob-award">
          <div class="ob-award-main">
            <div class="ob-award-label">${a.label}</div>
            <div class="ob-award-meta">${a.teamName} &middot; ${a.leagueLabel}</div>
          </div>
          <div class="ob-award-pts ${obPtsClass(a.pts)}">${obSignedPts(a.pts)}</div>
        </div>
      `).join('')
    : `<div class="ob-empty">Nothing confirmed yet &mdash; no result has settled for these teams.</div>`;

  const pendingHtml = row.provisionalTotal !== 0
    ? `<div class="ob-pending"><span class="ob-stripe-swatch"></span>${obSignedPts(row.provisionalTotal)} provisional in the breakdown</div>`
    : '';

  return `
    <div class="ob-expand">
      <div class="ob-section-title">Confirmed points by league</div>
      <div class="ob-lg-list">${leagueRowsHtml}</div>
      ${pendingHtml}
      <div class="ob-section-title">Confirmed awards</div>
      <div class="ob-award-list">${awardsHtml}</div>
      <button class="ob-detail-link" onclick="obOpenDetail('${row.id}')">Full breakdown for ${row.name} &rarr;</button>
    </div>
  `;
}

function obListHtml(){
  const rows = obRows();
  const leader = rows[0];
  const last = rows[rows.length - 1];
  const liveLeagues = LEAGUES.filter(l => rows.some(r => (r.leagues.find(x => x.league.key === l.key) || {}).pts)).length;

  const rowsHtml = rows.map((row, i) => {
    const rank = i + 1;
    const expanded = obExpandedId === row.id;
    return `
      <div class="ob-row ${rank === 1 ? 'leader' : ''} ${expanded ? 'expanded' : ''} ${row.id === currentDraftTeamId ? 'current' : ''}">
        <div class="ob-row-head" onclick="obToggleRow('${row.id}')">
          <div class="ob-rank">${rank}</div>
          <div class="ob-row-main">
            <div class="ob-name">${row.name}</div>
            <div class="ob-mix-line">
              ${obMixBarHtml(row)}
              <div class="ob-mix-label">${obMixLabel(row)}</div>
            </div>
          </div>
          <div class="ob-total ${obPtsClass(row.confirmedTotal)}">${row.confirmedTotal === 0 ? '0 pts' : obSignedPts(row.confirmedTotal) + ' pts'}</div>
        </div>
        ${expanded ? obExpandHtml(row) : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="ob-stats">
      <div class="ob-stat"><div class="ob-stat-num">${leader ? leader.name : '&mdash;'}</div><div class="ob-stat-lbl">Leader</div></div>
      <div class="ob-stat"><div class="ob-stat-num">${leader && last ? (leader.confirmedTotal - last.confirmedTotal) : 0} pts</div><div class="ob-stat-lbl">1st&rarr;${DRAFT_TEAMS.length}th</div></div>
      <div class="ob-stat"><div class="ob-stat-num">${liveLeagues} of ${LEAGUES.length}</div><div class="ob-stat-lbl">Leagues live</div></div>
    </div>
    <div class="ob-list">${rowsHtml}</div>
    <div class="ob-foot">Ranked by confirmed points. Open a drafter to see provisional points still riding on live tables.</div>
  `;
}

// ---- Detail ----

function obDetailHtml(row, rank){
  const confirmed = row.confirmedTotal;
  const provisional = row.provisionalTotal;
  const span = Math.abs(confirmed) + Math.abs(provisional);
  const confirmedPct = span ? (Math.abs(confirmed) / span) * 100 : 0;
  const provisionalPct = span ? (Math.abs(provisional) / span) * 100 : 0;

  const leagueCardsHtml = row.leagues.map(x => {
    const awards = row.awards.filter(a => a.leagueKey === x.league.key)
      .sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts));
    const teams = obTeamNamesFor(row.id, x.league);
    const rulesHtml = awards.length
      ? awards.map(a => `
          <div class="ob-rule" onclick="openTeamModal('${a.teamKey}')">
            <div class="ob-rule-main">
              <div class="ob-rule-label">${a.label}</div>
              <div class="ob-rule-meta">${a.teamName}${a.provisional ? '<span class="ob-prov-tag">Provisional</span>' : ''}</div>
            </div>
            <div class="ob-rule-pts ${obPtsClass(a.pts)}">${obSignedPts(a.pts)}</div>
          </div>
        `).join('')
      : `<div class="ob-empty">Nothing settled yet in ${x.league.label}. Every rule is still available.</div>`;

    const provHtml = x.provisional !== 0
      ? `<div class="ob-card-prov"><span class="ob-stripe-swatch"></span>${obSignedPts(x.provisional)} of this is provisional &mdash; it moves with the table</div>`
      : '';

    return `
      <div class="ob-card">
        <div class="ob-card-head">
          <span class="ob-lg-dot" style="background:${x.pts === 0 ? 'var(--hairline-strong)' : obLeagueColor(x.league.key)};"></span>
          <div class="ob-card-main">
            <div class="ob-card-title">${LEAGUE_SCORING[x.league.key] ? LEAGUE_SCORING[x.league.key].full : x.league.label}</div>
            <div class="ob-card-sub">${x.league.season} &middot; ${teams.join(' &middot; ') || '&mdash;'}</div>
          </div>
          <div class="ob-card-pts ${obPtsClass(x.pts)}">${obSignedPts(x.pts)}</div>
        </div>
        <div class="ob-rule-list">${rulesHtml}</div>
        ${provHtml}
      </div>
    `;
  }).join('');

  return `
    <button class="ob-back" onclick="obCloseDetail()">&larr; Overall standings</button>
    <div class="ob-detail-head">
      <div class="ob-detail-rank">Rank ${rank} of ${DRAFT_TEAMS.length}</div>
      <h2 class="ob-detail-name">${row.name}</h2>
      <div class="ob-detail-total"><b class="${obPtsClass(row.total)}">${obSignedPts(row.total)}</b><span>points total</span></div>
      <div class="ob-split">
        <span class="ob-split-confirmed" style="width:${confirmedPct}%;"></span>
        <span class="ob-split-provisional" style="width:${provisionalPct}%;"></span>
      </div>
      <div class="ob-split-legend">
        <span class="ob-pill confirmed"><i></i>${obSignedPts(confirmed)} confirmed</span>
        <span class="ob-pill provisional"><i></i>${obSignedPts(provisional)} provisional</span>
      </div>
      <div class="ob-split-note">${provisional === 0
        ? 'Everything here is settled &mdash; no points are riding on a live table.'
        : 'Provisional points come from where a club sits in the table right now. They move until the season ends.'}</div>
    </div>
    <div class="ob-section-title">How the points were awarded</div>
    <div class="ob-cards">${leagueCardsHtml}</div>
    <button class="ob-detail-link" onclick="setDraftTeam('${row.id}'); switchView('board');">See ${row.name}'s board &rarr;</button>
  `;
}

// ---- Entry points ----

function obToggleRow(id){
  obExpandedId = obExpandedId === id ? null : id;
  renderOverallStandings();
}

function obOpenDetail(id){
  obDetailId = id;
  window.scrollTo(0, 0);
  renderOverallStandings();
}

function obCloseDetail(){
  obDetailId = null;
  renderOverallStandings();
}

// TEMPORARY: see the block above obDrafterAwards — delete alongside it.
function obSyncModeToggle(){
  document.querySelectorAll('.ob-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === obMode);
  });
}

const OB_SIM_BANNER_HTML = `<div class="ob-sim-banner">Showing simulated results for preview &mdash; switch Data to Real for live standings.</div>`;

function renderOverallStandings(){
  const container = document.getElementById('overall-content');
  if(!container) return;
  obSyncModeToggle();
  const simBanner = obMode === 'simulated' ? OB_SIM_BANNER_HTML : '';

  if(obDetailId){
    const rows = obRows();
    const idx = rows.findIndex(r => r.id === obDetailId);
    if(idx !== -1){
      container.innerHTML = `${simBanner}<div class="ob-detail">${obDetailHtml(rows[idx], idx + 1)}</div>`;
      return;
    }
    obDetailId = null;
  }

  container.innerHTML = simBanner + obListHtml();
}

// ---- Live data: fetch, cache, render ----

const liveDataCache = {}; // teamKey -> { info, last, next, table, fetchedAt }

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
// approach as migrateEplAchievementsToFacts above.
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
function loadLiveDataCache(){
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

// ---- TheSportsDB V2 migration (see the migration plan) ----
// Phase 3, batched by league: only leagues listed here read from V2
// (via the worker proxy, premium key held server-side) — everyone
// else stays on V1 until their league's batch lands, verified against
// real data first. EPL is fully migrated (Phase 2 piloted it on
// Liverpool/Newcastle, side-by-side-diffed against V1, then the rest
// of the league followed once that checked out). Remove this list
// entirely (and the V1 branch below it) once every league has
// migrated — Phase 4.
const V2_MIGRATED_LEAGUES = ['epl'];

// V2's team-lookup response is shaped { lookup: [...] } and its
// schedule responses are { schedule: [...] } — normalized here into
// the { teams: [...] } / { results: [...], events: [...] } shape V1
// used, so renderStats/renderForm/renderNext don't need to change at
// all for the pilot. Field *names* inside each entry (strSport,
// strHomeTeam, intHomeScore, strTimestamp, etc.) matched V1's
// one-for-one when checked against real data — see Phase 1 findings.
async function fetchSportsDbV2Team(id){
  const v2 = await fetchJSON(`${DASHBOARD_WORKER_BASE}/sportsdb/team/${id}`);
  return v2 && v2.lookup ? { teams: v2.lookup } : null;
}

async function fetchSportsDbV2Schedule(kind, id){
  const v2 = await fetchJSON(`${DASHBOARD_WORKER_BASE}/sportsdb/${kind}/${id}`);
  const list = (v2 && v2.schedule) || [];
  return { results: list, events: list };
}

// ---- Team info: a separate, much slower-refreshing cache ----
// Of the 3 SportsDB calls a team used to make every single refresh
// tick, "team info" (sport, founded year, stadium, colors, badge) is
// essentially static — it doesn't change mid-season, unlike a team's
// last result or next fixture. Pulling it out of the per-tick fetch
// and caching it for a full day (persisted, so a fresh page load
// doesn't even need to re-fetch it) cuts a third of the per-team call
// volume with no real freshness cost. Same TTL-cache shape as
// eplStandingsCache/rundownDayCache elsewhere in this file.
// Legacy single-blob key, migrated away from below (see
// migrateLegacyLiveDataCache's twin just above for why: one growing
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

function loadTeamInfoCache(){
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
  if(!meta || (!meta.sportsdbId && !meta.rundownTeamId)) return null;

  // TheSportsDB-primary teams (the common case): everything comes from
  // TheSportsDB, optionally supplemented with TheRundown's in-game
  // state for leagues in RUNDOWN_SPORT_ID (see fetchRundownEventForTeam).
  if(meta.sportsdbId){
    const id = meta.sportsdbId;
    const useV2 = V2_MIGRATED_LEAGUES.includes(meta.leagueKey);
    // Standings come from the one shared eplStandingsCache (see
    // fetchEplStandingsTable) rather than each team fetching and
    // storing its own copy of the same league table — renderStats
    // reads eplStandingsCache.table directly, so nothing from that
    // fetch needs to end up in this team's own bundle. Team info is
    // similarly decoupled — see fetchTeamInfoCached — since it's the
    // one piece of this bundle that's effectively static.
    const [info, last, next, , rundownEvent] = await Promise.all([
      fetchTeamInfoCached(teamKey, id, useV2),
      useV2 ? fetchSportsDbV2Schedule('schedule-previous', id) : fetchJSON(`${API_BASE}eventslast.php?id=${id}`),
      useV2 ? fetchSportsDbV2Schedule('schedule-next', id) : fetchJSON(`${API_BASE}eventsnext.php?id=${id}`),
      meta.leagueId ? fetchEplStandingsTable() : Promise.resolve(null),
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

function renderStats(id, bundle){
  const el = document.getElementById('live-stats');
  if(!el) return;

  const row = eplStandingsCache.table ? eplStandingsCache.table.find(r => r.idTeam === id) : null;
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

  el.innerHTML = bundle.rundownOnly
    ? `<div class="stat-cell" style="flex:1;"><div class="lbl">Team info isn't available from this data source</div></div>`
    : `<div class="stat-cell" style="flex:1;"><div class="lbl">Live stats unavailable right now</div></div>`;
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

// Board-row pill: reuses whatever the modal fetch already pulled
// (last result / next fixture) rather than fetching anything extra,
// so it stays inside the same 30 req/min budget described above.
function renderRowStatus(teamKey, bundle){
  const el = document.getElementById('row-status-' + teamKey);
  if(!el) return;
  const meta = TEAM_META[teamKey];
  const id = meta.sportsdbId;

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
      el.textContent = 'Today ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      el.className = 'row-status next';
      return;
    }
  }

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

  const hasLive = !!meta.sportsdbId || !!meta.rundownTeamId;
  const cached = hasLive ? liveDataCache[teamKey] : null;
  const tracker = trackerSectionHtml(teamKey);

  modalContent.innerHTML = `
    <div class="modal-accent" style="background:${meta.accent};"></div>
    <div class="modal-head">
      ${teamBadgeHtml(meta)}
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
loadLiveDataCache();
loadEplStandingsCache();
loadTeamInfoCache();
renderBoard();

// Paint every team's row-status pill from whatever's cached (possibly
// from a previous browser session) before the first real fetch even
// starts, so nothing sits blank waiting for its turn in the staggered
// refresh below. TEAM_META[teamKey] is checked in case a cache entry
// is left over from a team that no longer exists after a data.js edit.
for(const teamKey of Object.keys(liveDataCache)){
  if(TEAM_META[teamKey]) renderRowStatus(teamKey, liveDataCache[teamKey]);
}

backgroundRefreshTick();
setInterval(backgroundRefreshTick, REFRESH_STEP_MS);

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
