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
const APP_VERSION = '2026.09.11-3';

// ---- Bookmarkable state ----
// Mirrors the drafter/league/data-mode/tab selections into the URL's
// query string (?team=, ?league=, ?data=, ?view=) via
// history.replaceState — no reload, no new back-button entries — so a
// bookmark captures exactly what was on screen when it was saved, not
// just whatever this one browser's localStorage remembers. Each setter
// (setDraftTeam, setStandingsFilter, setObMode, switchView) calls this
// with its own key; a null value removes that param so the default,
// un-bookmarked state stays a clean URL with no query string at all.
function updateUrlParam(key, value){
  try {
    const url = new URL(window.location.href);
    if(value === null || value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(null, '', url);
  } catch (e){
    // URL/history unavailable (very old browser, sandboxed iframe,
    // etc.) — the app still works, it just won't be bookmarkable.
  }
}

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
// below) so it's also bookmarkable/shareable across browsers/devices.
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
  updateUrlParam('team', id);
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

  chipsEl.innerHTML = LEAGUES.map(l => `<div class="filter-chip" onclick="scrollToLeague('${l.key}')">${FILTER_CHIP_LABELS[l.key] || l.label}</div>`).join('');

  leaguesEl.innerHTML = LEAGUES.map(league => {
    const leagueTeams = teamsForCurrentDraftTeam(league);
    totalTeams += leagueTeams.length;
    const teamsHtml = leagueTeams.map(teamKey => {
      const meta = TEAM_META[teamKey];
      const cfbRecordHtml = league.key === 'cfb' ? `<span class="cfb-record" id="cfb-record-${teamKey}"></span>` : '';
      return `
        <div class="team clickable" onclick="openTeamModal('${teamKey}')">
          ${teamBadgeHtml(meta)}
          <div class="team-main">
            <div class="team-name">${meta.name}</div>
            <div class="team-sub">${meta.boardSub}${cfbRecordHtml}</div>
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

// ---- League Facts ----
// A league on this model has moved off the per-team checklist below:
// instead of marking "Relegation" on Liverpool's own tracker, you mark
// the real-world fact once — "who got relegated" — from that league's
// Results modal, and every drafter who owns one of the teams involved
// is credited automatically. Rank rules (rankAuto in LEAGUE_SCORING)
// skip marking entirely and are read straight off a live standings
// table once it loads (EPL only, for now — see getLeagueRuleTeams).
//
// Manually-marked facts are shared across everyone looking at the
// dashboard, not just saved in your own browser — they're held in
// Workers KV behind the same Cloudflare Worker used for the TheRundown
// comparison (see DASHBOARD_WORKER_BASE / worker/rundown-proxy.js,
// whose KNOWN_LEAGUES allowlist already covers every league here).
// localStorage is kept alongside as a fallback: it's what renders
// instantly before the network responds, and what's used if
// DASHBOARD_WORKER_BASE is empty or unreachable.
//
// Storage shape: { [ruleLabel]: [teamKey, ...] }, one such blob per
// league in LEAGUE_FACTS_LEAGUES. Every other league still uses the
// per-team ACHIEVEMENTS_KEY checklist below.
const LEAGUE_FACTS_LEAGUES = ['epl', 'cfb'];

const leagueFactsCache = {}; // leagueKey -> { data, loading, error }
function factsCacheFor(leagueKey){
  return leagueFactsCache[leagueKey] || (leagueFactsCache[leagueKey] = { data: null, loading: false, error: false });
}

// EPL was the pilot for this feature and kept its original bare
// localStorage key (with the legacy { epl: {...} }-nested shape some
// early versions wrote); every league added since gets its own
// suffixed key instead of sharing that one flat slot.
function localFactsKey(leagueKey){
  return leagueKey === 'epl' ? LEAGUE_FACTS_KEY : `${LEAGUE_FACTS_KEY}:${leagueKey}`;
}

function factsMigratedKey(leagueKey){
  return leagueKey === 'epl' ? EPL_FACTS_MIGRATED_KEY : `teamDashboardFactsMigrated:${leagueKey}`;
}

function loadLocalLeagueFacts(leagueKey){
  try {
    const parsed = JSON.parse(localStorage.getItem(localFactsKey(leagueKey)));
    if(!parsed) return {};
    // Earlier versions of this feature stored { epl: {...} } (facts
    // nested per league, in case other leagues moved to this model
    // too). Unwrap that shape if we find it; otherwise this is already
    // the flat rule-map saveLocalLeagueFacts writes today.
    return (parsed[leagueKey] && typeof parsed[leagueKey] === 'object') ? parsed[leagueKey] : parsed;
  } catch (e){
    return {};
  }
}

function saveLocalLeagueFacts(leagueKey, facts){
  try {
    localStorage.setItem(localFactsKey(leagueKey), JSON.stringify(facts));
  } catch (e){
    // localStorage unavailable (private browsing, etc.) — facts just won't persist locally.
  }
}

// Synchronous read used everywhere the app needs "what's marked right
// now": the shared copy once it's loaded, the local fallback until
// then. Kicks off the network fetch on first read, same lazy-load
// pattern as fetchEplStandingsTable.
function currentLeagueFacts(leagueKey){
  const cache = factsCacheFor(leagueKey);
  if(cache.data === null && !cache.loading && !cache.error) fetchLeagueFacts(leagueKey);
  return cache.data || loadLocalLeagueFacts(leagueKey);
}

async function fetchLeagueFacts(leagueKey){
  const cache = factsCacheFor(leagueKey);
  if(cache.data !== null || cache.loading || !DASHBOARD_WORKER_BASE) return;
  cache.loading = true;
  const data = await fetchJSON(`${DASHBOARD_WORKER_BASE}/facts/${leagueKey}`);
  cache.loading = false;
  // If a mark was made locally while this was in flight, cache.data is
  // no longer null — don't clobber that edit with the (now stale) GET.
  if(cache.data !== null) return;
  if(data && typeof data === 'object'){
    cache.data = data;
    renderStandings();
    renderLeagueResultsModal(leagueKey);
  } else {
    cache.error = true;
  }
}

// Pushes the current facts to both the local fallback and the shared
// store. The PUT is fire-and-forget — if it fails (offline, worker
// down) the mark still sticks locally, it just won't show up for
// anyone else until the next successful sync.
function persistLeagueFacts(leagueKey, facts){
  saveLocalLeagueFacts(leagueKey, facts);
  if(!DASHBOARD_WORKER_BASE) return;
  fetch(`${DASHBOARD_WORKER_BASE}/facts/${leagueKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(facts)
  }).catch(err => console.warn('[League Facts]', leagueKey, 'failed to sync to shared store', err));
}

// One-time migration so anyone who'd already ticked boxes under the old
// per-team checklist doesn't see their marks vanish when a league moves
// onto this model. Safe to run every load — it no-ops once that
// league's factsMigratedKey is set. Only touches the local fallback; if
// this browser ever calls addLeagueFact/removeLeagueFact afterward,
// that push syncs these forward to the shared store like any other edit.
function migrateAchievementsToFacts(leagueKey){
  try {
    if(localStorage.getItem(factsMigratedKey(leagueKey))) return;
  } catch (e){ return; }

  const oldData = loadAchievements();
  const facts = loadLocalLeagueFacts(leagueKey);

  Object.keys(oldData).forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    if(!meta || meta.leagueKey !== leagueKey) return;
    (oldData[teamKey] || []).forEach(label => {
      const list = facts[label] || (facts[label] = []);
      if(!list.includes(teamKey)) list.push(teamKey);
    });
  });

  saveLocalLeagueFacts(leagueKey, facts);
  try { localStorage.setItem(factsMigratedKey(leagueKey), '1'); } catch (e){}
}

function findLeagueRule(leagueKey, ruleLabel){
  return LEAGUE_SCORING[leagueKey].rules.find(r => r.label === ruleLabel);
}

// Teams currently satisfying a rule — auto-derived from the live table
// for rankAuto rules (EPL only, for now), or read from the
// manually-marked facts otherwise. obRuleTeams (see the Overall tab
// section below) picks this up automatically for any league listed in
// LEAGUE_FACTS_LEAGUES.
function getLeagueRuleTeams(leagueKey, rule){
  if(!LEAGUE_FACTS_LEAGUES.includes(leagueKey)) return null;
  if(rule.rankAuto){
    const table = leagueKey === 'epl' ? eplStandingsCache.table : null;
    if(!table) return [];
    const total = table.length;
    return table
      .filter(row => {
        const rank = parseInt(row.intRank, 10);
        return rule.rankAuto.bottom ? rank > total - rule.rankAuto.bottom : rank === rule.rankAuto.rank;
      })
      .map(row => findDraftedTeamByName(leagueKey, row.strTeam))
      .filter(Boolean);
  }
  return currentLeagueFacts(leagueKey)[rule.label] || [];
}

function addLeagueFact(leagueKey, ruleLabel, teamKey){
  const rule = findLeagueRule(leagueKey, ruleLabel);
  if(!rule || rule.rankAuto || !teamKey) return;

  const cache = factsCacheFor(leagueKey);
  const facts = cache.data || (cache.data = currentLeagueFacts(leagueKey));
  if(rule.exclusive){
    facts[ruleLabel] = [teamKey];
  } else {
    const list = facts[ruleLabel] || (facts[ruleLabel] = []);
    if(!list.includes(teamKey)) list.push(teamKey);
  }
  persistLeagueFacts(leagueKey, facts);
  renderLeagueResultsModal(leagueKey);
}

function removeLeagueFact(leagueKey, ruleLabel, teamKey){
  const cache = factsCacheFor(leagueKey);
  const facts = cache.data || (cache.data = currentLeagueFacts(leagueKey));
  const list = facts[ruleLabel] || [];
  const idx = list.indexOf(teamKey);
  if(idx === -1) return;
  list.splice(idx, 1);
  persistLeagueFacts(leagueKey, facts);
  renderLeagueResultsModal(leagueKey);
}

// Refreshes the rows inside the Results modal in place, if it's the
// thing currently open — mirrors renderTrackerSection's guard so a
// stray fact edit can't repaint over whatever the user has since
// navigated to.
function renderLeagueResultsModal(leagueKey){
  const modalContent = document.getElementById('modal-content');
  if(!modalContent || modalContent.dataset.activeLeagueResults !== leagueKey) return;
  const league = LEAGUES.find(l => l.key === leagueKey);
  const rowsHtml = LEAGUE_SCORING[leagueKey].rules.map(r => leagueFactRowHtml(league, r)).join('');
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
  if(LEAGUE_FACTS_LEAGUES.includes(meta.leagueKey)){
    return scoring.rules.reduce((sum, r) => sum + (getLeagueRuleTeams(meta.leagueKey, r).includes(teamKey) ? r.pts : 0), 0);
  }
  const achieved = loadAchievements()[teamKey] || [];
  return scoring.rules.reduce((sum, r) => sum + (achieved.includes(r.label) ? r.pts : 0), 0);
}

// The slice of a team's points that comes from current-standings rules
// (rankAuto) rather than a real, locked-in fact — these can still move
// as the table changes before the season ends. EPL-only for now: no
// other league has a rankAuto rule yet, so this is always 0 elsewhere
// even for other LEAGUE_FACTS_LEAGUES members like CFB.
function computeTeamProvisionalPoints(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring || !LEAGUE_FACTS_LEAGUES.includes(meta.leagueKey)) return 0;
  return scoring.rules.reduce((sum, r) => sum + (r.rankAuto && getLeagueRuleTeams(meta.leagueKey, r).includes(teamKey) ? r.pts : 0), 0);
}

function trackerSectionHtml(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring) return '';

  const total = computeTeamPoints(teamKey);

  // Facts-based leagues are marked from the Standings tab now (see
  // League Facts panel), not per-team — this is a read-only summary of
  // where things stand.
  if(LEAGUE_FACTS_LEAGUES.includes(meta.leagueKey)){
    const provisionalPts = computeTeamProvisionalPoints(teamKey);
    const itemsHtml = scoring.rules.map(r => {
      const achieved = getLeagueRuleTeams(meta.leagueKey, r).includes(teamKey);
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
      <button class="tracker-manage-link" onclick="openLeagueResultsModal('${meta.leagueKey}');">Marked from Results &rarr;</button>
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
// (getLeagueRuleTeams below) all read eplStandingsCache.table directly
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

// Same idea as findDraftedTeamByName, but for upstream data keyed by
// TheRundown's numeric team_id (e.g. the CFB ranking table) rather than
// a free-text team name — an exact id match, no normalization needed.
function findDraftedTeamByRundownId(leagueKey, rundownTeamId){
  const league = LEAGUES.find(l => l.key === leagueKey);
  if(!league || !rundownTeamId) return null;
  return league.teams.find(teamKey => TEAM_META[teamKey].rundownTeamId === rundownTeamId) || null;
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
  epl: 'English Premier League',
  cfb: 'College Football'
};

// Shortened further still for the filter chip row only — the Teams
// tab's league jump-to chips and the Standings tab's league filter
// chips. Every other use of a league's label (Board section headers,
// the Standings header above, modal titles) keeps LEAGUES[].label.
const FILTER_CHIP_LABELS = {
  cfb: 'CFB',
  mcbb: 'CBB'
};

// ---- CFB Standings: combined win percentage across each drafter's 3 teams ----
// Unlike EPL, TheSportsDB has no real standings data for college
// football — it lumps every team under one umbrella "NCAA Division 1"
// league with no conference breakdown, and that league's table endpoint
// returns genuinely empty (confirmed 2026-09-10, see the migration
// plan). So there's no "League" table view possible here, only "Person".
//
// TheRundown's per-sport team list — the same endpoint already used to
// help map rundownTeamId in js/data.js — carries a "record" field
// ("10-7") per team, which is the source here instead. One shared fetch
// for the whole league (mirrors eplStandingsCache: one call, not one
// per team), reusing the existing /teams/{sportId} worker route.
const CFB_RECORDS_CACHE_KEY = 'teamDashboardCfbRecordsCache';
// A team's record only changes after that team's own game (at most a
// couple of times a week), far slower than EPL's continuous slate — no
// need for EPL's 15min cadence here. Matches the worker's own
// CACHE_TTL_SECONDS.rundownTeams so both layers agree on freshness.
const CFB_RECORDS_TTL_MS = 60 * 60 * 1000;
const cfbRecordsCache = { byTeamId: null, error: false, loading: false, fetchedAt: null };
let cfbRecordsPromise = null;

function cfbRecordsIsFresh(){
  return !!cfbRecordsCache.byTeamId && !!cfbRecordsCache.fetchedAt && (Date.now() - cfbRecordsCache.fetchedAt) < CFB_RECORDS_TTL_MS;
}

function saveCfbRecordsCache(){
  try { localStorage.setItem(CFB_RECORDS_CACHE_KEY, JSON.stringify(cfbRecordsCache)); } catch (e){}
}

function loadCfbRecordsCache(){
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
function parseWinLossRecord(record){
  const m = /^(\d+)-(\d+)/.exec(record || '');
  return m ? { wins: parseInt(m[1], 10), losses: parseInt(m[2], 10) } : null;
}

function fetchCfbRecords(){
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
      // fetchEplStandingsTable follows above.
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
// same cfbRecordsCache the Standings tab already fetches, just painted
// onto the per-team span rather than re-rendering the whole board (see
// renderRowStatus above for the same targeted-update pattern).
function cfbRecordLabel(meta){
  const rec = meta.rundownTeamId ? (cfbRecordsCache.byTeamId || {})[meta.rundownTeamId] : null;
  if(!rec || !rec.record) return '';
  return typeof rec.ranking === 'number' ? `#${rec.ranking} &middot; ${rec.record}` : rec.record;
}

function renderCfbCardRecord(teamKey){
  const el = document.getElementById('cfb-record-' + teamKey);
  if(!el) return;
  const label = cfbRecordLabel(TEAM_META[teamKey]);
  el.innerHTML = label ? ` &middot; ${label}` : '';
}

function renderAllCfbCardRecords(){
  LEAGUES.find(l => l.key === 'cfb').teams.forEach(renderCfbCardRecord);
}

// ---- CFB Ranking: the real AP/CFP-style Top 25 ----
// TheSportsDB has no poll/ranking data at all, but TheRundown's
// /sports/{sportId}/teams response — the exact same payload already
// fetched above for win-loss records — carries a "ranking" field per
// team (1-25 for the current Top 25, absent entirely for every
// unranked team). No extra request needed: this just reads a field
// cfbRecordsCache.byTeamId was already discarding.
function computeCfbRankingTable(){
  const byTeamId = cfbRecordsCache.byTeamId || {};
  return Object.values(byTeamId)
    .filter(t => typeof t.ranking === 'number' && t.ranking >= 1 && t.ranking <= 25)
    .sort((a, b) => a.ranking - b.ranking);
}

function renderCfbRankingRow(team){
  const teamKey = findDraftedTeamByRundownId('cfb', team.team_id);
  const meta = teamKey ? TEAM_META[teamKey] : {
    name: team.name,
    badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
    badgeText: abbrFromName(team.name),
    badgeUrl: null
  };
  const draftedByHtml = teamKey
    ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
    : '';

  return `
    <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
      <div class="standings-rank">${team.ranking}</div>
      ${teamBadgeHtml(meta)}
      <div class="team-main">
        <div class="team-name">${meta.name}</div>
        <div class="team-sub">${team.record || ''}</div>
      </div>
      ${draftedByHtml}
    </div>
  `;
}

// Toggle between the real national Top 25 and each drafter's combined
// record — same idea as eplStandingsMode above. Defaults to "ranking"
// since that's the real external data, matching EPL's "table" default.
let cfbStandingsMode = 'ranking';

function setCfbStandingsMode(mode){
  cfbStandingsMode = mode;
  renderStandings();
}

function cfbStandingsToggleHtml(){
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
function computeCfbDrafterCombined(){
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

  const byTeamId = cfbRecordsCache.byTeamId || {};
  league.teams.forEach(teamKey => {
    const meta = TEAM_META[teamKey];
    const team = meta.rundownTeamId ? byTeamId[meta.rundownTeamId] : null;
    const rec = team && parseWinLossRecord(team.record);
    if(!rec) return;
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

function renderCfbByDrafterRow(row, rank){
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

function leagueBlockHtml(league, bodyHtml){
  const resultsChipHtml = LEAGUE_FACTS_LEAGUES.includes(league.key)
    ? `<div class="scoring-chip" onclick="openLeagueResultsModal('${league.key}')">Results</div>`
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
  const selected = getLeagueRuleTeams(league.key, rule);
  const isAuto = !!rule.rankAuto;

  const chipsHtml = selected.length
    ? selected.map(teamKey => {
        const meta = TEAM_META[teamKey];
        const drafter = DRAFT_TEAMS.find(d => d.id === meta.draftTeamId);
        const removeBtn = isAuto ? '' : `<button class="fact-chip-x" onclick="removeLeagueFact('${league.key}', '${rule.label}', '${teamKey}')" aria-label="Remove ${meta.name}">&times;</button>`;
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
    <select class="fact-picker" onchange="if(this.value){ addLeagueFact('${league.key}', '${rule.label}', this.value); this.value=''; }">
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

function openLeagueResultsModal(leagueKey){
  const league = LEAGUES.find(l => l.key === leagueKey);
  const data = LEAGUE_SCORING[leagueKey];
  const rowsHtml = data.rules.map(r => leagueFactRowHtml(league, r)).join('');

  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = '';
  modalContent.dataset.activeLeagueResults = leagueKey;

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
// below, this isn't persisted to localStorage, so it resets to "All"
// each time you open the app with no URL state of its own. It IS
// mirrored into ?league= (see applyUrlState) so a specific league's
// Standings view is still bookmarkable/shareable, just not "sticky"
// the way the drafter picker is.
let standingsFilterKey = 'all';

function setStandingsFilter(key){
  standingsFilterKey = key;
  updateUrlParam('league', key === 'all' ? null : key);
  renderStandings();
}

function renderStandings(){
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
      let bodyHtml;
      if(cfbRecordsCache.byTeamId){
        let rowsHtml;
        if(cfbStandingsMode === 'byDrafter'){
          rowsHtml = computeCfbDrafterCombined().map((row, i) => renderCfbByDrafterRow(row, i + 1)).join('');
        } else {
          const rankingRows = computeCfbRankingTable();
          rowsHtml = rankingRows.length
            ? rankingRows.map(team => renderCfbRankingRow(team)).join('')
            : `<div class="no-live-note">No teams currently ranked.</div>`;
        }
        bodyHtml = cfbStandingsToggleHtml() + rowsHtml;
        fetchCfbRecords(); // no-op if already fresh; quietly refreshes in the background if stale
      } else if(cfbRecordsCache.error){
        bodyHtml = `<div class="no-live-note">No data available.</div>`;
      } else {
        fetchCfbRecords();
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

function switchView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  updateUrlParam('view', view === 'board' ? null : view);
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
let obLegendOpen = false;

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
  const teams = getLeagueRuleTeams(league.key, rule);
  if(Array.isArray(teams)) return teams;
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
  updateUrlParam('data', mode === 'real' ? null : mode);
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

function obLegendHtml(){
  const chips = LEAGUES.map(l => `
    <div class="ob-legend-chip">
      <span class="ob-legend-dot" style="background:${obLeagueColor(l.key)};"></span>
      ${l.label}
    </div>
  `).join('');
  const preview = LEAGUES.slice(0, 4).map(l =>
    `<span style="background:${obLeagueColor(l.key)};"></span>`
  ).join('');

  return `
    <div class="ob-legend">
      <button class="ob-legend-toggle" onclick="obToggleLegend()">
        <span class="ob-legend-toggle-dots">${preview}</span>
        ${obLegendOpen ? 'Hide colors' : 'What do the colors mean?'}
      </button>
      ${obLegendOpen ? `<div class="ob-legend-panel">${chips}</div>` : ''}
    </div>
  `;
}

function obListHtml(){
  const rows = obRows();

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
            </div>
          </div>
          <div class="ob-total ${obPtsClass(row.confirmedTotal)}">${row.confirmedTotal === 0 ? '0 pts' : obSignedPts(row.confirmedTotal) + ' pts'}</div>
        </div>
        ${expanded ? obExpandHtml(row) : ''}
      </div>
    `;
  }).join('');

  return `
    ${obLegendHtml()}
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

function obToggleLegend(){
  obLegendOpen = !obLegendOpen;
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
// approach as migrateAchievementsToFacts above.
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
// of the league followed once that checked out). CFB followed the same
// pattern: piloted against the live worker on Oregon (both directions
// of the schedule endpoint returned correct real results/fixtures,
// field-for-field matching V1's shape) plus a handful of others
// (Texas A&M, Arizona, Ohio State, Georgia) before batching in the
// rest of the league — CFB's V1 path was CORS-blocked from the
// browser anyway, so this also fixes Last Result/Next Game actually
// populating for these teams. Remove this list entirely (and the V1
// branch below it) once every league has migrated — Phase 4.
//
// IMPORTANT — this only matters for NFL/NBA/NHL/MLB/WNBA/College BB,
// the leagues still on V1 from before the premium key existed. Any
// LEAGUE ADDED FROM NOW ON must be wired straight onto V2 (added here
// immediately, never left on the V1 branch below to "migrate later")
// — we're paying for the premium SportsDB key specifically so new
// integrations don't inherit V1's free-tier CORS breakage (the exact
// bug that left CFB's Last Result/Next Game blank until this migration).
const V2_MIGRATED_LEAGUES = ['epl', 'cfb'];

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

function renderStats(meta, bundle){
  const el = document.getElementById('live-stats');
  if(!el) return;
  const id = meta.sportsdbId;

  const row = eplStandingsCache.table ? eplStandingsCache.table.find(r => r.idTeam === id) : null;
  if(row){
    el.innerHTML = `
      <div class="stat-cell"><div class="num">${ordinal(row.intRank)}</div><div class="lbl">Position</div></div>
      <div class="stat-cell"><div class="num">${row.intPoints}</div><div class="lbl">Points</div></div>
      <div class="stat-cell"><div class="num">${row.intWin}-${row.intDraw}-${row.intLoss}</div><div class="lbl">W-D-L</div></div>
    `;
    return;
  }

  // CFB: TheRundown's /teams/{sportId} (already fetched for the
  // Standings tab and the board's per-team record — see
  // fetchCfbRecords/renderCfbCardRecord) carries a real record and
  // AP Top 25 rank, more useful here than TheSportsDB's generic
  // Sport/Founded/Stadium bio fields.
  if(meta.leagueKey === 'cfb'){
    const rec = meta.rundownTeamId ? (cfbRecordsCache.byTeamId || {})[meta.rundownTeamId] : null;
    if(rec && rec.record){
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${rec.record}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num">${typeof rec.ranking === 'number' ? '#' + rec.ranking : 'NR'}</div><div class="lbl">AP Rank</div></div>
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
  renderStats(meta, bundle);
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

LEAGUE_FACTS_LEAGUES.forEach(migrateAchievementsToFacts);
loadLiveDataCache();
loadEplStandingsCache();
loadCfbRecordsCache();
loadTeamInfoCache();
renderBoard();
applyUrlState();

// Paint every team's row-status pill from whatever's cached (possibly
// from a previous browser session) before the first real fetch even
// starts, so nothing sits blank waiting for its turn in the staggered
// refresh below. TEAM_META[teamKey] is checked in case a cache entry
// is left over from a team that no longer exists after a data.js edit.
for(const teamKey of Object.keys(liveDataCache)){
  if(TEAM_META[teamKey]) renderRowStatus(teamKey, liveDataCache[teamKey]);
}

// Same idea for CFB records/ranks: paint from whatever's cached, then
// kick off a fetch regardless of whether the Standings tab (the only
// other place that calls this) has been opened yet, so the board's
// records aren't stuck waiting on that.
renderAllCfbCardRecords();
fetchCfbRecords();

backgroundRefreshTick();
setInterval(backgroundRefreshTick, REFRESH_STEP_MS);

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
