/* ============================================================
   Live data: fetch, cache, and render each team's stats/last
   result/next fixture, plus the team detail modal and the staggered
   background refresh loop that keeps it all current.
   ============================================================ */
import { TEAM_META } from './data.js';
import { fetchJSON, ordinal, formatKickoff, formatUpdatedAt, teamBadgeHtml, lockBodyScroll, unlockBodyScroll } from './utils.js';
import { API_BASE, fetchRundownEventForTeam, isRundownEventLive, V2_MIGRATED_LEAGUES, UPCOMING_CHIP_LEAGUES, fetchSportsDbV2Team, fetchSportsDbV2Schedule } from './api.js';
import { fetchEplStandingsTable, findEspnEplRow } from './standings-epl.js';
import { fetchEspnEplTeamSchedule } from './espn.js';
import { cfbRecordsCache } from './standings-cfb.js';
import { findEspnNflRow } from './standings-nfl.js';
import { trackerSectionHtml } from './league-facts.js';

const LIVE_DATA_CACHE_KEY = 'teamDashboardLiveDataCache';

export const liveDataCache = {}; // teamKey -> { info, last, next, table, fetchedAt }

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
// approach as migrateAchievementsToFacts (js/league-facts.js).
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
export function loadLiveDataCache(){
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

// ---- Team info: a separate, much slower-refreshing cache ----
// Of the 3 SportsDB calls a team used to make every single refresh
// tick, "team info" (sport, founded year, stadium, colors, badge) is
// essentially static — it doesn't change mid-season, unlike a team's
// last result or next fixture. Pulling it out of the per-tick fetch
// and caching it for a full day (persisted, so a fresh page load
// doesn't even need to re-fetch it) cuts a third of the per-team call
// volume with no real freshness cost. Same TTL-cache shape as
// eplStandingsCache/rundownDayCache elsewhere.
// Legacy single-blob key, migrated away from below (see
// migrateLegacyLiveDataCache's twin above for why: one growing
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

export function loadTeamInfoCache(){
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

  if(meta.sportsdbId){
    const id = meta.sportsdbId;
    const useV2 = V2_MIGRATED_LEAGUES.includes(meta.leagueKey);

    // EPL: real schedule (past results + every remaining fixture) from
    // ESPN (js/espn.js) instead of TheSportsDB V2's schedule-previous/
    // schedule-next — see fetchEspnEplTeamSchedule for what that adds
    // (real venue names, TV broadcasts). Standings have to load first:
    // ESPN's team ids don't line up with TheSportsDB's sportsdbId (same
    // issue findEspnEplRow already solves for the stat strip), so this
    // club's ESPN id is resolved by name through the standings table
    // rather than carried as its own TEAM_META field.
    if(meta.leagueKey === 'epl'){
      await fetchEplStandingsTable();
      const row = findEspnEplRow(meta);
      const [info, eplSchedule, rundownEvent] = await Promise.all([
        fetchTeamInfoCached(teamKey, id, useV2),
        row ? fetchEspnEplTeamSchedule(row.id) : Promise.resolve(null),
        fetchRundownEventForTeam(meta)
      ]);
      const bundle = { info, last: null, next: null, eplSchedule, rundownEvent, rundownTeamId: meta.rundownTeamId || null, fetchedAt: new Date() };
      setTeamBundle(teamKey, bundle);
      return bundle;
    }

    // TheSportsDB-primary teams (the common case): everything comes from
    // TheSportsDB, optionally supplemented with TheRundown's in-game
    // state for leagues in RUNDOWN_SPORT_ID (see fetchRundownEventForTeam).
    // Team info is decoupled from this per-tick fetch — see
    // fetchTeamInfoCached — since it's the one piece of this bundle
    // that's effectively static.
    const [info, last, next, rundownEvent] = await Promise.all([
      fetchTeamInfoCached(teamKey, id, useV2),
      useV2 ? fetchSportsDbV2Schedule('schedule-previous', id) : fetchJSON(`${API_BASE}eventslast.php?id=${id}`),
      useV2 ? fetchSportsDbV2Schedule('schedule-next', id) : fetchJSON(`${API_BASE}eventsnext.php?id=${id}`),
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

export function renderStats(meta, bundle){
  const el = document.getElementById('live-stats');
  if(!el) return;

  // EPL: same ESPN standings source the Standings tab reads (see
  // findEspnEplRow/eplRecordLabel in js/standings-epl.js) — this used
  // to match on TheSportsDB's idTeam/sportsdbId; ESPN's team ids don't
  // line up with those, so this matches by club name instead, same as
  // everywhere else in standings-epl.js.
  if(meta.leagueKey === 'epl'){
    const row = findEspnEplRow(meta);
    if(row){
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${ordinal(row.rank)}</div><div class="lbl">Position</div></div>
        <div class="stat-cell"><div class="num">${row.points}</div><div class="lbl">Points</div></div>
        <div class="stat-cell"><div class="num">${row.wins}-${row.draws}-${row.losses}</div><div class="lbl">W-D-L</div></div>
      `;
      // Champions League/Europa League/Relegation — straight off ESPN's
      // own qualification-zone note, which TheSportsDB's table never
      // had at all. Sits in the modal head (see openTeamModal), not the
      // stat strip, so this only updates that one span rather than
      // re-rendering stats around it.
      const zoneEl = document.getElementById('zone-tag');
      if(zoneEl){
        // display toggled (not just emptied) so an inactive zone doesn't
        // still eat a flex gap slot in .modal-sub next to it.
        zoneEl.style.display = row.zone ? 'inline-block' : 'none';
        zoneEl.innerHTML = row.zone
          ? `<span class="zone-tag" style="background:${row.zoneColor || 'rgba(255,255,255,0.14)'};">${row.zone}</span>`
          : '';
      }
      return;
    }
  }

  // CFB: TheRundown's /teams/{sportId} (already fetched for the
  // Standings tab and the board's per-team record — see
  // fetchCfbRecords/renderCfbCardRecord in js/standings-cfb.js)
  // carries a real record and AP Top 25 rank, more useful here than
  // TheSportsDB's generic Sport/Founded/Stadium bio fields.
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

  // NFL: same ESPN standings source the Standings tab reads (see
  // findEspnNflRow/nflRecordLabel in js/standings-nfl.js) — this used
  // to read TheRundown's per-team division field instead, which could
  // (and did) drift from what the Standings tab showed once that moved
  // to ESPN. "Conference" here, not "Division", for the same reason the
  // Standings tab's toggle was relabeled — ESPN's simple standings
  // endpoint doesn't have real division data, only conference.
  if(meta.leagueKey === 'nfl'){
    const row = findEspnNflRow(meta);
    if(row){
      const recordLabel = `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`;
      el.innerHTML = `
        <div class="stat-cell"><div class="num">${recordLabel}</div><div class="lbl">Record</div></div>
        <div class="stat-cell"><div class="num" style="font-size:14px;">${row.conferenceAbbr || '—'}</div><div class="lbl">Conference</div></div>
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

// Last 5 results as a compact row of pills, oldest on the left ending
// with the most recent (matches recentEvents' own newest-first order,
// so this just reverses a slice of it) — the detailed line rendered
// below it always covers the rightmost/most recent one already.
function formStripHtml(recentEvents){
  const last5 = recentEvents.slice(0, 5).reverse();
  return `
    <div class="form-strip">
      ${last5.map(evt => {
        let cls = 'd', label = 'D';
        if(evt.ownScore > evt.oppScore){ cls = 'w'; label = 'W'; }
        else if(evt.ownScore < evt.oppScore){ cls = 'l'; label = 'L'; }
        const title = `${evt.isHome ? 'vs' : 'at'} ${evt.opponentName} · ${evt.ownScore}-${evt.oppScore}`;
        return `<div class="form-pill ${cls}" title="${title}">${label}</div>`;
      }).join('')}
    </div>
  `;
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

  // EPL: real schedule data from ESPN (js/espn.js) instead of
  // TheSportsDB's eventslast — see fetchEspnEplTeamSchedule. Adds a
  // "Form" strip (last 5 results) above the usual detailed line, and a
  // real venue name on that line — neither available from TheSportsDB.
  if(bundle.eplSchedule){
    const recent = bundle.eplSchedule.recent;
    const evt = recent && recent[0];
    if(!evt){
      el.innerHTML = `<div class="loading-note">No recent result found.</div>`;
      return;
    }
    let result = 'd', label = 'D';
    if(evt.ownScore > evt.oppScore){ result = 'w'; label = 'W'; }
    else if(evt.ownScore < evt.oppScore){ result = 'l'; label = 'L'; }
    el.innerHTML = `
      ${formStripHtml(recent)}
      <div class="form-item">
        <div class="form-pill ${result}">${label}</div>
        <div class="form-detail">
          <span class="opp">${evt.opponentName}</span>
          <span class="meta">${evt.isHome ? 'Home' : 'Away'}${evt.venueName ? ' · ' + evt.venueName : ''}</span>
        </div>
        <div class="form-score">${evt.ownScore}–${evt.oppScore}</div>
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

  // EPL: real schedule data from ESPN (js/espn.js) instead of
  // TheSportsDB's eventsnext — see fetchEspnEplTeamSchedule. Adds the
  // real venue and TV broadcast, neither available from TheSportsDB.
  if(bundle.eplSchedule){
    const evt = bundle.eplSchedule.upcoming && bundle.eplSchedule.upcoming[0];
    if(!evt){
      el.innerHTML = `<div class="loading-note">No upcoming match scheduled yet.</div>`;
      return;
    }
    const metaLine = [evt.isHome ? 'Home' : 'Away', evt.venueName, evt.broadcast].filter(Boolean).join(' · ');
    el.innerHTML = `
      <div class="nm-left">
        <div class="nm-teams">${evt.isHome ? 'vs' : 'at'} ${evt.opponentName}</div>
        <div class="nm-when">${formatKickoff(evt.date)}</div>
        <div class="nm-venue">${metaLine}</div>
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

// Compact date label for the "next match" row-status pill — "Today
// 6:00 PM" for a game today, otherwise a short weekday + time
// ("Sat 11:30 AM") since there's no room in the pill for a full date.
function formatChipUpcoming(d){
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if(d.toDateString() === new Date().toDateString()) return 'Today ' + time;
  return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + time;
}

// Board-row pill: reuses whatever the modal fetch already pulled
// (last result / next fixture) rather than fetching anything extra,
// so it stays inside the same 30 req/min budget described in js/api.js.
export function renderRowStatus(teamKey, bundle){
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
      el.textContent = formatChipUpcoming(d);
      el.className = 'row-status next';
      return;
    }
  }

  // EPL: real schedule data from ESPN (js/espn.js) instead of
  // TheSportsDB's eventsnext — see fetchEspnEplTeamSchedule. EPL is
  // itself in UPCOMING_CHIP_LEAGUES below, so this pill always shows
  // the next match regardless of when it falls, same as before.
  if(bundle.eplSchedule){
    const nextEvt = bundle.eplSchedule.upcoming && bundle.eplSchedule.upcoming[0];
    if(nextEvt){
      const d = new Date(nextEvt.date);
      if(!isNaN(d.getTime())){
        el.textContent = formatChipUpcoming(d);
        el.className = 'row-status next';
        return;
      }
    }
    el.textContent = '';
    el.className = 'row-status';
    return;
  }

  // CFB shows the next match regardless of when it falls, rather than
  // only for today's game — see UPCOMING_CHIP_LEAGUES in js/api.js.
  // Every other league keeps "today's game, else last result", since a
  // nightly slate makes "next match" far less interesting than a look
  // back at how last night went.
  const showsUpcoming = UPCOMING_CHIP_LEAGUES.includes(meta.leagueKey);

  const nextEvt = bundle.next && bundle.next.events && bundle.next.events[0];
  if(nextEvt && nextEvt.strTimestamp){
    const d = new Date(nextEvt.strTimestamp.includes('Z') ? nextEvt.strTimestamp : nextEvt.strTimestamp + 'Z');
    if(!isNaN(d.getTime()) && (showsUpcoming || d.toDateString() === new Date().toDateString())){
      el.textContent = formatChipUpcoming(d);
      el.className = 'row-status next';
      return;
    }
  }

  if(!showsUpcoming){
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
  }

  el.textContent = '';
  el.className = 'row-status';
}

export function renderLiveBundle(teamKey, bundle){
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

export function openTeamModal(teamKey){
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
        <div class="modal-sub">${meta.sub}${hasLive ? ' <span class="live-badge">LIVE</span>' : ''}${meta.leagueKey === 'epl' ? '<span id="zone-tag" style="display:none;"></span>' : ''}</div>
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
window.openTeamModal = openTeamModal;

export function closeTeamModal(){
  document.getElementById('modal-overlay').classList.remove('open');
  const modalContent = document.getElementById('modal-content');
  modalContent.dataset.activeTeam = '';
  modalContent.dataset.activeLeagueResults = '';
  unlockBodyScroll();
}
window.closeTeamModal = closeTeamModal;

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
export const REFRESH_STEP_MS = LIVE_TEAM_KEYS.length ? REFRESH_CYCLE_MS / LIVE_TEAM_KEYS.length : REFRESH_CYCLE_MS;
let refreshCursor = 0;

export async function backgroundRefreshTick(){
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
