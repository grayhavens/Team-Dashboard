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

// Bump this on every deploy that changes what's on screen. It's shown
// in the corner of the app (see #build-tag in index.html) so you can
// confirm a device is actually running the latest build rather than
// a stale cached copy — compare what's on screen to the version
// mentioned when a change ships.
const APP_VERSION = '2026.09.10-3';

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

  document.getElementById('modal-content').innerHTML = `
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
  const achieved = loadAchievements()[teamKey] || [];
  return scoring.rules.reduce((sum, r) => sum + (achieved.includes(r.label) ? r.pts : 0), 0);
}

function trackerSectionHtml(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring) return '';

  const total = computeTeamPoints(teamKey);
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
  return `
    <div class="league">
      <div class="league-tab">
        <div class="league-tab-left">${league.label} <div class="scoring-chip" onclick="openLeagueModal('${league.key}')">Scoring</div></div>
        <span class="n">${league.season}</span>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function renderStandings(){
  const container = document.getElementById('standings-content');
  if(!container) return;

  const blocksHtml = LEAGUES.map(league => {
    if(league.key !== 'epl'){
      return leagueBlockHtml(league, `<div class="no-live-note">No data available.</div>`);
    }

    if(eplStandingsCache.table){
      const rowsHtml = eplStandingsMode === 'byDrafter'
        ? computeEplDrafterCombined().map((row, i) => renderEplByDrafterRow(row, i + 1)).join('')
        : eplStandingsCache.table.map(row => renderStandingsRow('epl', row)).join('');
      return leagueBlockHtml(league, eplStandingsToggleHtml() + rowsHtml);
    }

    if(eplStandingsCache.error){
      return leagueBlockHtml(league, `<div class="no-live-note">No data available.</div>`);
    }

    fetchEplStandingsTable();
    return leagueBlockHtml(league, `<div class="loading-note">Loading standings…</div>`);
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
  document.getElementById('modal-content').dataset.activeTeam = '';
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

renderBoard();
backgroundRefreshTick();
setInterval(backgroundRefreshTick, REFRESH_STEP_MS);

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
