/* ============================================================
   Shared engine behind every "flat" (conference/league-grouped) ESPN
   standings view — NBA, NHL, MLB, and WNBA all follow the identical
   shape once fetched (see fetchEspnFlatStandings in js/espn.js): pick a
   conference/league or "Person". NBA/NHL/MLB additionally nest a real
   Divisions view under each conference (an optional fetchDivisionStandings
   passed into createFlatStandingsBoard — see js/standings-nba.js/-nhl.js/
   -mlb.js), same Division-vs-Conference sub-toggle idea NFL pioneered
   in js/standings-nfl.js, generalized here once 3 of these 4 leagues
   needed it too. WNBA has no real divisions (a single unified
   conference table), so it simply omits that option — this board
   behaves exactly as it did before division support existed for any
   league that doesn't pass it.

   Matching an ESPN row back to a drafted team uses an EXACT match
   (after normalizeTeamName), not the looser substring rule
   findDraftedTeamByName (js/utils.js) uses for EPL/CFB — tried the
   substring rule here first and it produced a real false positive:
   "Nets" is a literal substring of "Hornets", so Charlotte Hornets
   matched to the Nets. EPL/CFB's substring cases are all whole-word
   prefixes ("Newcastle" in "Newcastle United"), which happen not to
   collide with any other drafted club's name, but nothing here
   guarantees that in general, so this module doesn't risk it. Checked
   live (2026-09-12) against all 120 NBA/NHL/MLB/WNBA drafted teams:
   ESPN's team.name (the plain nickname, e.g. "Cavaliers") matches this
   app's own TEAM_META name exactly in every case but one — "Blazers"
   vs "Trail Blazers" — a one-line alias in TEAM_NAME_ALIASES
   (js/utils.js) instead of a bespoke table here. (Dallas' TEAM_META
   name is "Mavericks" — ESPN's own nickname — rather than the app's
   original shorter "Mavs", which needed the same kind of alias until
   the name itself was changed to match.)

   Each createFlatStandingsBoard(...) call below builds one league's
   cache, fetch-with-cache, toggle state, and render functions — see
   js/standings-nba.js/standings-nhl.js/standings-mlb.js/
   standings-wnba.js for the thin per-league config each passes in
   (just what's genuinely sport-specific: the fetch function, the two
   conference/league labels, and how a record renders/sorts/combines).
   ============================================================ */
import { LEAGUES, TEAM_META, DRAFT_TEAMS, LEAGUE_SCORING } from './data.js';
import { normalizeTeamName, teamBadgeHtml, abbrFromName } from './utils.js';
import { renderStandings } from './board.js';
import { liveDataCache, renderStats } from './live-data.js';

function findFlatTeamKey(leagueKey, realName){
  const target = normalizeTeamName(realName);
  const teams = LEAGUES.find(l => l.key === leagueKey).teams;
  return teams.find(teamKey => normalizeTeamName(TEAM_META[teamKey].name) === target) || null;
}

export function createFlatStandingsBoard(opts){
  const {
    leagueKey, cacheKey, ttlMs, fetchStandings,
    conferences, // [{ abbr: 'East', mode: 'east', label: 'East' }, { abbr: 'West', mode: 'west', label: 'West' }]
    recordLabel, // (row) => "41-30" style string for a standings row / board card
    sortConference, // (a, b) => number — orders one conference's teams
    combinedInit, // () => fresh per-drafter accumulator, e.g. { wins: 0, losses: 0 }
    combinedAccumulate, // (bucket, row) => void — adds one team's row into a drafter's bucket
    combinedLabel, // (bucket) => "41-30 · .577" style string for the Person view
    combinedSort, // (a, b) => number — orders the Person view (found/not-found already handled)
    // Optional — only NBA/NHL/MLB pass this (WNBA has no real divisions
    // to nest under; see js/standings-wnba.js). () => Promise<[{
    // division, conferenceAbbr, teams }]> | null, same shape
    // fetchEspnNbaDivisionStandings/-Nhl-/-Mlb- (js/espn.js) return.
    // When omitted, this board behaves exactly as it did before division
    // support existed — no extra cache, no sub-toggle, no per-league
    // change needed for WNBA.
    fetchDivisionStandings
  } = opts;
  const hasDivisions = !!fetchDivisionStandings;

  const cache = { rows: null, error: false, loading: false, fetchedAt: null };
  let promise = null;

  function isFresh(){
    return !!cache.rows && !!cache.fetchedAt && (Date.now() - cache.fetchedAt) < ttlMs;
  }

  function save(){
    try { localStorage.setItem(cacheKey, JSON.stringify(cache)); } catch (e){}
  }

  function load(){
    try {
      const raw = localStorage.getItem(cacheKey);
      if(!raw) return;
      const parsed = JSON.parse(raw);
      if(parsed && parsed.rows){
        cache.rows = parsed.rows;
        cache.fetchedAt = parsed.fetchedAt || null;
      }
    } catch (e){}
  }

  function fetchCached(){
    if(cache.loading) return promise;
    if(isFresh()) return Promise.resolve();

    cache.loading = true;
    promise = (async () => {
      const rows = await fetchStandings();
      cache.loading = false;
      if(rows && rows.length){
        cache.rows = rows;
        cache.error = false;
        cache.fetchedAt = Date.now();
        save();
      } else if(!cache.rows){
        // Only flag "no data" if we never had a table to fall back on —
        // a transient failure on a background refresh should keep
        // showing the last-known-good table, not blank it out.
        cache.error = true;
      }
      renderStandings();
      renderAllCardRecords();
    })();
    return promise;
  }

  // findFlatTeamKey needs a teamKey to compare against, not a meta
  // object, so this resolves meta -> teamKey once up front rather than
  // threading it through every call site.
  function teamKeyFor(meta){
    return LEAGUES.find(l => l.key === leagueKey).teams.find(tk => TEAM_META[tk] === meta) || null;
  }

  // Given a drafted team's own meta, find its row in the cache — the
  // reverse direction of findFlatTeamKey, used by the board card label
  // and (from js/live-data.js) the team modal's stat strip.
  function findRowForMeta(meta){
    const rows = cache.rows;
    if(!rows) return null;
    const teamKey = teamKeyFor(meta);
    if(!teamKey) return null;
    return rows.find(row => findFlatTeamKey(leagueKey, row.teamNickname) === teamKey) || null;
  }

  function cardRecordLabel(meta){
    const row = findRowForMeta(meta);
    return row ? recordLabel(row) : '';
  }

  function renderCardRecord(teamKey){
    const el = document.getElementById(leagueKey + '-record-' + teamKey);
    if(!el) return;
    const label = cardRecordLabel(TEAM_META[teamKey]);
    el.innerHTML = label ? ` &middot; ${label}` : '';
  }

  function renderAllCardRecords(){
    LEAGUES.find(l => l.key === leagueKey).teams.forEach(renderCardRecord);
  }

  function computeConferenceStandings(confAbbr){
    const rows = (cache.rows || []).filter(row => row.conferenceAbbr === confAbbr);
    return rows.sort(sortConference);
  }

  // ---- Division standings (optional — only wired up when the caller passed fetchDivisionStandings) ----
  // Same shape/cadence as espnNflDivisionCache in js/standings-nfl.js,
  // kept as its own cache (separate from the flat one above) so the
  // cheap flat data everything else needs (board cards, the modal,
  // Person) doesn't pay for this heavier fetch every time.
  const DIVISION_CACHE_KEY = cacheKey + 'Divisions';
  const divisionCache = { divisions: null, error: false, loading: false, fetchedAt: null };
  let divisionPromise = null;

  function divisionIsFresh(){
    return !!divisionCache.divisions && !!divisionCache.fetchedAt && (Date.now() - divisionCache.fetchedAt) < ttlMs;
  }

  function saveDivisionCache(){
    try { localStorage.setItem(DIVISION_CACHE_KEY, JSON.stringify(divisionCache)); } catch (e){}
  }

  function loadDivisionCache(){
    if(!hasDivisions) return;
    try {
      const raw = localStorage.getItem(DIVISION_CACHE_KEY);
      if(!raw) return;
      const parsed = JSON.parse(raw);
      if(parsed && parsed.divisions){
        divisionCache.divisions = parsed.divisions;
        divisionCache.fetchedAt = parsed.fetchedAt || null;
      }
    } catch (e){}
  }

  function fetchDivisionCached(){
    if(!hasDivisions) return Promise.resolve();
    if(divisionCache.loading) return divisionPromise;
    if(divisionIsFresh()) return Promise.resolve();

    divisionCache.loading = true;
    divisionPromise = (async () => {
      const divisions = await fetchDivisionStandings();
      divisionCache.loading = false;
      if(divisions && divisions.length){
        divisionCache.divisions = divisions;
        divisionCache.error = false;
        divisionCache.fetchedAt = Date.now();
        saveDivisionCache();
      } else if(!divisionCache.divisions){
        // Same "don't blank out a good cache on a transient miss" rule
        // as the flat cache above.
        divisionCache.error = true;
      }
      renderStandings();
      // The team modal's Division stat cell (js/live-data.js's
      // renderStats) reads this same cache, and can easily open before
      // this heavier fetch resolves (it's only triggered on-demand, not
      // eagerly at boot, since most sessions never open a given team's
      // modal) — same "activeTeam" re-render used by CFB/EPL/NFL's own
      // standings fetches for this exact race.
      const activeTeam = document.getElementById('modal-content').dataset.activeTeam;
      const activeMeta = activeTeam && TEAM_META[activeTeam];
      if(activeMeta && activeMeta.leagueKey === leagueKey){
        renderStats(activeMeta, liveDataCache[activeTeam] || {});
      }
    })();
    return divisionPromise;
  }

  // conferenceAbbr narrows to that conference's own divisions — reads
  // the explicit conferenceAbbr field each division carries (set by the
  // fetcher's own division map in js/espn.js) rather than parsing it
  // off the division name, since MLB's names collide across leagues
  // ("AL East"/"NL East" both end in "East").
  function computeDivisionStandings(conferenceAbbr){
    const divisions = divisionCache.divisions || [];
    return divisions
      .filter(d => d.conferenceAbbr === conferenceAbbr)
      .map(d => ({ name: d.division, teams: [...d.teams].sort(sortConference) }));
  }

  // Given a drafted team's own meta, find which division it's in — used
  // by the team modal's Division stat cell (js/live-data.js). Reverse
  // direction of computeDivisionStandings, same idea as findRowForMeta
  // above but walking the (much less frequently needed) division cache
  // instead of the flat one.
  function findDivisionForMeta(meta){
    const divisions = divisionCache.divisions;
    if(!divisions) return null;
    const teamKey = teamKeyFor(meta);
    if(!teamKey) return null;
    return divisions.find(d => d.teams.some(t => findFlatTeamKey(leagueKey, t.teamNickname) === teamKey)) || null;
  }

  // shortName (not the possibly-disambiguated `division` field — see
  // js/espn.js) since the conference is always shown as its own,
  // separate stat cell right next to this one.
  function divisionLabel(meta){
    const div = findDivisionForMeta(meta);
    return div ? div.shortName : null;
  }

  function renderGroupHeader(label){
    return `<div class="standings-group-header">${label}</div>`;
  }

  function renderStandingsRow(row, rank){
    const teamKey = findFlatTeamKey(leagueKey, row.teamNickname);
    // An undrafted team has no TEAM_META entry (so no SportsDB badge),
    // but ESPN's own logoUrl covers it — real crest, same onerror
    // fallback to the plain monogram if it ever fails (mirrors
    // renderNflStandingsRow in js/standings-nfl.js). Mascot only
    // ("Celtics"), not the full "Boston Celtics" — every drafted
    // team's own TEAM_META.name in these 4 leagues is mascot-only too,
    // so this keeps undrafted rows visually consistent with them.
    const meta = teamKey ? TEAM_META[teamKey] : {
      name: row.teamNickname || row.teamName,
      badgeStyle: 'background: rgba(255,255,255,0.08); color: var(--text-sub); border-color: var(--hairline-strong);',
      badgeText: row.abbreviation || abbrFromName(row.teamNickname || row.teamName),
      badgeUrl: row.logoUrl || null
    };
    const draftedByHtml = teamKey
      ? `<div class="drafted-by-chip">${DRAFT_TEAMS.find(d => d.id === meta.draftTeamId).name}</div>`
      : '';

    return `
      <div class="standings-row ${teamKey ? 'clickable' : ''}" ${teamKey ? `onclick="openTeamModal('${teamKey}')"` : ''}>
        <div class="standings-rank">${rank}</div>
        ${teamBadgeHtml(meta)}
        <div class="team-main">
          <div class="team-name">${meta.name}</div>
          <div class="team-sub">${recordLabel(row)}</div>
        </div>
        ${draftedByHtml}
      </div>
    `;
  }

  function computeDrafterCombined(){
    const league = LEAGUES.find(l => l.key === leagueKey);
    const byDrafter = {};
    DRAFT_TEAMS.forEach(d => {
      byDrafter[d.id] = Object.assign({ id: d.id, name: d.name, found: 0, total: 0, teamNames: [] }, combinedInit());
    });

    league.teams.forEach(teamKey => {
      const meta = TEAM_META[teamKey];
      byDrafter[meta.draftTeamId].total++;
      byDrafter[meta.draftTeamId].teamNames.push(meta.name);
    });

    (cache.rows || []).forEach(row => {
      const teamKey = findFlatTeamKey(leagueKey, row.teamNickname);
      if(!teamKey) return;
      const bucket = byDrafter[TEAM_META[teamKey].draftTeamId];
      combinedAccumulate(bucket, row);
      bucket.found++;
    });

    return Object.values(byDrafter).sort((a, b) => {
      if(a.found === 0 && b.found === 0) return 0;
      if(a.found === 0) return 1;
      if(b.found === 0) return -1;
      return combinedSort(a, b);
    });
  }

  function renderByDrafterRow(row, rank){
    const teamsLabel = row.teamNames.join(' & ');
    let note = '';
    if(row.found === 0) note = 'No data yet';
    else if(row.found < row.total) note = `${row.found} of ${row.total} teams reporting`;

    // Same "currently leading, not locked in" idea as every other
    // league's combined-record bonus tag (see EPL/CFB/NFL's own
    // renderXByDrafterRow) — pays out once the season actually ends.
    const bonus = LEAGUE_SCORING[leagueKey].bonus;
    const isLeader = row.found > 0 && rank === 1 && bonus;
    const leaderTagHtml = isLeader ? `<span class="provisional-tag">+${bonus.pts} provisional</span>` : '';

    return `
      <div class="standings-row">
        <div class="standings-rank">${row.found > 0 ? rank : '—'}</div>
        <div class="team-main">
          <div class="team-name">${row.name}${leaderTagHtml}</div>
          <div class="team-sub">${teamsLabel}${note ? ' &middot; ' + note : ''}</div>
        </div>
        <div class="person-record-chip">${row.found > 0 ? combinedLabel(row) : '&mdash;'}</div>
      </div>
    `;
  }

  let mode = conferences[0].mode; // e.g. 'east' | 'west' | 'byDrafter'
  // Only meaningful when hasDivisions is true and mode isn't 'byDrafter'
  // — mirrors nflConferenceSubMode in js/standings-nfl.js: Divisions
  // (the heavier per-division fetch) vs. that conference's flat Full
  // ranking (the cheap one every other view already needs).
  let conferenceSubMode = 'division';

  function setMode(m){
    mode = m;
    renderStandings();
  }

  function setConferenceSubMode(subMode){
    conferenceSubMode = subMode;
    renderStandings();
  }

  function toggleHtml(){
    const buttons = conferences.map(c =>
      `<button class="toggle-btn ${mode === c.mode ? 'active' : ''}" onclick="${setModeGlobalName}('${c.mode}')">${c.label}</button>`
    ).join('');
    const topRow = `
      <div class="standings-toggle">
        ${buttons}
        <button class="toggle-btn ${mode === 'byDrafter' ? 'active' : ''}" onclick="${setModeGlobalName}('byDrafter')">Person</button>
      </div>
    `;
    if(!hasDivisions || mode === 'byDrafter') return topRow;

    const subRow = `
      <div class="standings-toggle standings-subtoggle">
        <button class="toggle-btn ${conferenceSubMode === 'division' ? 'active' : ''}" onclick="${setSubModeGlobalName}('division')">Divisions</button>
        <button class="toggle-btn ${conferenceSubMode === 'full' ? 'active' : ''}" onclick="${setSubModeGlobalName}('full')">Conference</button>
      </div>
    `;
    return topRow + subRow;
  }

  // Each league needs its own window.* entry point (inline onclick
  // handlers can't close over this factory's local `setMode`), named
  // predictably from the leagueKey so board.js's renderStandings body
  // for this league can just call it without importing anything new.
  const setModeGlobalName = `set${leagueKey[0].toUpperCase()}${leagueKey.slice(1)}StandingsMode`;
  window[setModeGlobalName] = setMode;
  const setSubModeGlobalName = `set${leagueKey[0].toUpperCase()}${leagueKey.slice(1)}ConferenceSubMode`;
  window[setSubModeGlobalName] = setConferenceSubMode;

  return {
    cache, isFresh, load, fetchCached,
    cardRecordLabel, renderCardRecord, renderAllCardRecords, findRowForMeta,
    getMode: () => mode, conferences,
    computeConferenceStandings, renderStandingsRow,
    computeDrafterCombined, renderByDrafterRow,
    toggleHtml,
    hasDivisions, divisionCache, loadDivisionCache, fetchDivisionCached,
    computeDivisionStandings, findDivisionForMeta, divisionLabel, renderGroupHeader,
    getConferenceSubMode: () => conferenceSubMode
  };
}
