/* ============================================================
   Overall view: cross-drafter leaderboard.

   The LIST shows confirmed points only (locked-in facts). Provisional
   points — the rankAuto slice that still moves with the live table —
   appear only in a drafter's breakdown, never folded into the ranking
   number. See obIsProvisional below for what counts as provisional.
   ============================================================ */
import { LEAGUES, LEAGUE_SCORING, DRAFT_TEAMS, TEAM_META } from './data.js';
import { updateUrlParam } from './utils.js';
import { getLeagueRuleTeams, isAchieved } from './league-facts.js';
import { currentDraftTeamId } from './board.js';

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
// open. Within-session view state only, same as standingsFilterKey in
// js/board.js.
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

export function setObMode(mode){
  if(mode !== 'real' && mode !== 'simulated') return;
  obMode = mode;
  try { localStorage.setItem(OB_DATA_MODE_KEY, mode); } catch (e){}
  updateUrlParam('data', mode === 'real' ? null : mode);
  renderOverallStandings();
}
window.setObMode = setObMode;

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

export function obToggleRow(id){
  obExpandedId = obExpandedId === id ? null : id;
  renderOverallStandings();
}
window.obToggleRow = obToggleRow;

export function obToggleLegend(){
  obLegendOpen = !obLegendOpen;
  renderOverallStandings();
}
window.obToggleLegend = obToggleLegend;

export function obOpenDetail(id){
  obDetailId = id;
  window.scrollTo(0, 0);
  renderOverallStandings();
}
window.obOpenDetail = obOpenDetail;

export function obCloseDetail(){
  obDetailId = null;
  renderOverallStandings();
}
window.obCloseDetail = obCloseDetail;

// TEMPORARY: see the block above obDrafterAwards — delete alongside it.
function obSyncModeToggle(){
  document.querySelectorAll('.ob-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === obMode);
  });
}

const OB_SIM_BANNER_HTML = `<div class="ob-sim-banner">Showing simulated results for preview &mdash; switch Data to Real for live standings.</div>`;

export function renderOverallStandings(){
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
