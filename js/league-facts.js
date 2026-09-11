/* ============================================================
   Season tracker (manual achievement checklist -> standings) and
   League Facts (shared, league-wide marks like cup winners).

   A league on the League Facts model has moved off the per-team
   checklist: instead of marking "Relegation" on Liverpool's own
   tracker, you mark the real-world fact once — "who got relegated" —
   from that league's Results modal, and every drafter who owns one of
   the teams involved is credited automatically. Rank rules (rankAuto
   in LEAGUE_SCORING) skip marking entirely and are read straight off a
   live standings table once it loads (EPL only, for now — see
   getLeagueRuleTeams).

   Manually-marked facts are shared across everyone looking at the
   dashboard, not just saved in your own browser — they're held in
   Workers KV behind the same Cloudflare Worker used for the TheRundown
   comparison (see DASHBOARD_WORKER_BASE / worker/rundown-proxy.js,
   whose KNOWN_LEAGUES allowlist already covers every league here).
   localStorage is kept alongside as a fallback: it's what renders
   instantly before the network responds, and what's used if
   DASHBOARD_WORKER_BASE is empty or unreachable.

   Storage shape: { [ruleLabel]: [teamKey, ...] }, one such blob per
   league in LEAGUE_FACTS_LEAGUES. Every other league still uses the
   per-team ACHIEVEMENTS_KEY checklist below.
   ============================================================ */
import { TEAM_META, LEAGUE_SCORING, LEAGUES, DRAFT_TEAMS } from './data.js';
import { fetchJSON, CLOSE_ICON_SVG, CHECK_ICON_SVG, CHEVRON_ICON_SVG, lockBodyScroll } from './utils.js';
import { DASHBOARD_WORKER_BASE } from './api.js';
import { eplStandingsCache, findEplTeamKeyByEspnName } from './standings-epl.js';
import { renderStandings } from './board.js';

const ACHIEVEMENTS_KEY = 'teamDashboardAchievements';
const LEAGUE_FACTS_KEY = 'teamDashboardLeagueFacts';
const EPL_FACTS_MIGRATED_KEY = 'teamDashboardEplFactsMigrated';

export function loadAchievements(){
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

export function isAchieved(teamKey, label){
  const all = loadAchievements();
  return !!(all[teamKey] && all[teamKey].includes(label));
}

export const LEAGUE_FACTS_LEAGUES = ['epl', 'cfb'];

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
export function migrateAchievementsToFacts(leagueKey){
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
// manually-marked facts otherwise. obRuleTeams (js/overall.js) picks
// this up automatically for any league listed in LEAGUE_FACTS_LEAGUES.
export function getLeagueRuleTeams(leagueKey, rule){
  if(!LEAGUE_FACTS_LEAGUES.includes(leagueKey)) return null;
  if(rule.rankAuto){
    const table = leagueKey === 'epl' ? eplStandingsCache.table : null;
    if(!table) return [];
    const total = table.length;
    return table
      .filter(row => {
        const rank = row.rank;
        return rule.rankAuto.bottom ? rank > total - rule.rankAuto.bottom : rank === rule.rankAuto.rank;
      })
      .map(row => findEplTeamKeyByEspnName(row.teamName))
      .filter(Boolean);
  }
  return currentLeagueFacts(leagueKey)[rule.label] || [];
}

export function addLeagueFact(leagueKey, ruleLabel, teamKey){
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
window.addLeagueFact = addLeagueFact;

export function removeLeagueFact(leagueKey, ruleLabel, teamKey){
  const cache = factsCacheFor(leagueKey);
  const facts = cache.data || (cache.data = currentLeagueFacts(leagueKey));
  const list = facts[ruleLabel] || [];
  const idx = list.indexOf(teamKey);
  if(idx === -1) return;
  list.splice(idx, 1);
  persistLeagueFacts(leagueKey, facts);
  renderLeagueResultsModal(leagueKey);
}
window.removeLeagueFact = removeLeagueFact;

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

// Which team's tracker body (the checklist itself, below the always-
// visible "Earned so far" summary) is expanded — at most one at a time,
// same within-session-only idea as obExpandedId in js/overall.js. Only
// one team modal can be open at once, so tracking a single teamKey
// (rather than a Set) is enough: opening a different team's modal
// naturally starts collapsed, since trackerExpandedTeamKey won't match
// its teamKey.
let trackerExpandedTeamKey = null;

export function toggleTrackerSection(teamKey){
  trackerExpandedTeamKey = trackerExpandedTeamKey === teamKey ? null : teamKey;
  renderTrackerSection(teamKey);
}
window.toggleTrackerSection = toggleTrackerSection;

export function toggleAchievementByIndex(teamKey, ruleIndex){
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
window.toggleAchievementByIndex = toggleAchievementByIndex;

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

// Header row shown whether the tracker is collapsed or expanded: the
// "Track This Season" title and the "Earned so far" summary stay
// visible either way, with a chevron (flipped via CSS when expanded)
// as the only visual cue that there's more underneath. Clicking
// anywhere on the row toggles it, not just the chevron itself.
function trackerHeadHtml(teamKey, totalHtml, expanded){
  return `
    <div class="tracker-head" onclick="toggleTrackerSection('${teamKey}')">
      <div>
        <div class="modal-section-title">Track This Season</div>
        <div class="tracker-total">${totalHtml}</div>
      </div>
      <div class="tracker-chevron ${expanded ? 'open' : ''}">${CHEVRON_ICON_SVG}</div>
    </div>
  `;
}

export function trackerSectionHtml(teamKey){
  const meta = TEAM_META[teamKey];
  const scoring = meta && LEAGUE_SCORING[meta.leagueKey];
  if(!scoring) return '';

  const expanded = trackerExpandedTeamKey === teamKey;
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

    const totalHtml = `Earned so far: <b>${confirmedPts >= 0 ? '+' : ''}${confirmedPts}</b> pt${Math.abs(confirmedPts) === 1 ? '' : 's'}${provisionalNoteHtml}`;
    const bodyHtml = expanded ? `
      <div class="tracker-body">
        <div class="tracker-list">${itemsHtml}</div>
        <button class="tracker-manage-link" onclick="openLeagueResultsModal('${meta.leagueKey}');">Marked from Results &rarr;</button>
      </div>
    ` : '';
    return trackerHeadHtml(teamKey, totalHtml, expanded) + bodyHtml;
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

  const totalHtml = `Earned so far: <b>${total >= 0 ? '+' : ''}${total}</b> pt${Math.abs(total) === 1 ? '' : 's'}`;
  const bodyHtml = expanded ? `<div class="tracker-body"><div class="tracker-list">${itemsHtml}</div></div>` : '';
  return trackerHeadHtml(teamKey, totalHtml, expanded) + bodyHtml;
}

function renderTrackerSection(teamKey){
  const el = document.getElementById('tracker-section');
  if(!el || document.getElementById('modal-content').dataset.activeTeam !== teamKey) return;
  el.innerHTML = trackerSectionHtml(teamKey);
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

export function openLeagueResultsModal(leagueKey){
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
window.openLeagueResultsModal = openLeagueResultsModal;
