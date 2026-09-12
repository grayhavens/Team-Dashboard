/* ============================================================
   ESPN HIDDEN API (see docs/espn-migration-plan.md for the full
   evaluation this started from). Backs CFB's AP Top 25, all of NFL's
   standings/rankings, and EPL's league table — see js/standings-cfb.js,
   js/standings-nfl.js and js/standings-epl.js for how each is wired in.

   ESPN's undocumented site API (site.web.api.espn.com — confirmed
   byte-identical to the older site.api.espn.com for shared paths, so
   this uses the .web. host going forward) serves real standings/
   rankings data with open CORS and no API key, unlike the two
   sources this app used to stitch together for this:
     - TheSportsDB has NO standings endpoint at all for NFL or CFB
       (lookuptable.php confirmed empty, every season tested).
     - TheRundown filled that gap before this migration but is paid/
       metered — a shared 20,000 data-points/day budget across all 8
       leagues that ran out entirely on 2026-09-11 (confirmed via the
       worker: 429 "Daily data point limit reached", used: 20018),
       taking down CFB ranks and NFL standings for everyone until the
       quota reset. TheRundown is still used for live in-game state
       and for leagues not yet migrated (see docs/espn-migration-plan.md).

   No worker proxy needed for anything below — every endpoint here
   returned `access-control-allow-origin: *` when queried with this
   app's real Origin header, so (unlike TheSportsDB V2 and TheRundown)
   these are fetched straight from the browser. The one ESPN endpoint
   that does need a server-side call is the bulk /teams?limit=1000
   list used for one-time ID-mapping lookups — it has no CORS headers
   at all, but that's an offline `curl` task, never something this
   client code calls at runtime.
   ============================================================ */

export const ESPN_SITE_BASE = 'https://site.web.api.espn.com';
// The hypermedia "core" API — a completely different, much more
// granular API than the "site" one above. Used only for NFL division
// standings (fetchEspnNflDivisionStandings below), which the site API
// doesn't have at all.
const ESPN_CORE_BASE = 'https://sports.core.api.espn.com';

async function fetchEspnJSON(path){
  try {
    const res = await fetch(`${ESPN_SITE_BASE}${path}`);
    if(!res.ok) return null;
    return await res.json();
  } catch (e){
    return null;
  }
}

async function fetchEspnCoreJSON(url){
  try {
    const res = await fetch(url);
    if(!res.ok) return null;
    return await res.json();
  } catch (e){
    return null;
  }
}

// Both endpoints below carry a team.logos[] array — used for teams
// this app doesn't have its own (SportsDB-sourced) badge for, i.e. a
// ranked/standings team nobody's drafted. Picks the entry tagged
// ["full","default"] (a transparent PNG, same shape as this app's
// existing SportsDB crests — see teamBadgeHtml in js/utils.js), falling
// back to whatever's first if that exact tag is ever missing.
function espnLogoUrl(team){
  if(!team || !Array.isArray(team.logos) || !team.logos.length) return null;
  const preferred = team.logos.find(l => Array.isArray(l.rel) && l.rel.includes('default'));
  return (preferred || team.logos[0]).href || null;
}

// team.displayName is usually "Location Name" (e.g. "Ohio State
// Buckeyes") pre-joined, but it's not reliable — confirmed live,
// ESPN's CFB rankings return `"displayName": null` for Alabama
// specifically (location/name are both fine: "Alabama"/"Crimson
// Tide"), so this rebuilds it from the parts rather than trusting the
// joined field outright.
function espnTeamName(team){
  if(!team) return '';
  return team.displayName || `${team.location || ''} ${team.name || ''}`.trim() || team.location || '';
}

// Shared by every "flat" (conference-grouped, no division nesting)
// standings puller — NFL, NBA, NHL, MLB and WNBA all share this exact
// response shape: one or more `children` groups (conferences/leagues),
// each with a `standings.entries` array of {team, stats[]}. Real
// division-by-division grouping (NFL only, so far — see
// fetchEspnNflDivisionStandings below) needs the much heavier
// hypermedia "core" API instead; this only covers the cheap, flat,
// one-request case every sport's board cards/team modal/"Person" view
// actually need.
// Returns raw rows: [{ id, conference, conferenceAbbr, teamName,
// abbreviation, logoUrl, stats: {name: value} }] — callers pick the
// specific stat names their sport actually displays, since those
// differ (NHL's otLosses/points, MLB's ties/gamesBehind, NBA/WNBA's
// winPercent/playoffSeed, etc — verified live per sport, see
// docs/espn-migration-plan.md).
async function fetchEspnFlatStandings(path){
  const data = await fetchEspnJSON(path);
  if(!data || !Array.isArray(data.children)) return null;

  const rows = [];
  data.children.forEach(conf => {
    const entries = (conf.standings && conf.standings.entries) || [];
    entries.forEach(entry => {
      const stats = {};
      (entry.stats || []).forEach(s => { stats[s.name] = s.value; });
      rows.push({
        id: entry.team.id,
        conference: conf.name,
        conferenceAbbr: conf.abbreviation,
        teamName: espnTeamName(entry.team),
        // The bare nickname ("Cavaliers"), no city — matches this app's
        // own TEAM_META.name exactly (see findFlatTeamKey in
        // js/standings-flat.js). teamName above is the full "Cleveland
        // Cavaliers" for display; matching against that instead would
        // need substring logic, which had a real false positive here
        // ("Nets" is a literal substring of "Hornets").
        teamNickname: entry.team.name,
        abbreviation: entry.team.abbreviation,
        logoUrl: espnLogoUrl(entry.team),
        stats
      });
    });
  });
  return rows;
}

// CONFERENCE-level standings only (32 teams split AFC/NFC) — verified
// live against actual results (e.g. Seattle showed 1-0/Rams 0-1
// immediately after their Week 1 final, while teams that hadn't
// played yet correctly still showed 0-0), so what it does return is
// fresh and correct, not just structurally plausible.
//
// This does NOT include division grouping — entry.team carries no
// division field on this endpoint; ESPN's site API only nests
// standings one level (by conference). Real division-by-division
// standings are fetchEspnNflDivisionStandings below, a much heavier
// call — this flat version stays cheap (one request) and is what
// backs everything that just needs a team's own record: board cards,
// the team modal, and the "Person" combined-win% view (see
// findEspnNflRow in js/standings-nfl.js).
// Shape returned: [{ id, conference, conferenceAbbr, teamName,
// abbreviation, logoUrl, wins, losses, ties, streak, pointsFor,
// pointsAgainst, winPercent }]
export async function fetchEspnNflStandings(){
  const rows = await fetchEspnFlatStandings('/apis/v2/sports/football/nfl/standings');
  if(!rows) return null;
  return rows.map(r => ({
    id: r.id, conference: r.conference, conferenceAbbr: r.conferenceAbbr,
    teamName: r.teamName, teamNickname: r.teamNickname, abbreviation: r.abbreviation, logoUrl: r.logoUrl,
    wins: r.stats.wins, losses: r.stats.losses, ties: r.stats.ties,
    streak: r.stats.streak, pointsFor: r.stats.pointsFor, pointsAgainst: r.stats.pointsAgainst,
    winPercent: r.stats.winPercent
  }));
}

// NBA/WNBA conference standings — verified live (2026-09-11). Same
// win%/games-behind display convention as MLB below, but by conference
// (East/West) rather than league (AL/NL), and no ties (basketball has
// none). playoffSeed is carried in `stats` if a future view wants a
// seed number instead of/alongside rank-by-percentage.
// Shape returned: [{ id, conference, conferenceAbbr, teamName,
// abbreviation, logoUrl, wins, losses, streak, winPercent, gamesBehind,
// pointsFor, pointsAgainst }]
function mapNbaLikeRow(r){
  return {
    id: r.id, conference: r.conference, conferenceAbbr: r.conferenceAbbr,
    teamName: r.teamName, teamNickname: r.teamNickname, abbreviation: r.abbreviation, logoUrl: r.logoUrl,
    wins: r.stats.wins, losses: r.stats.losses, streak: r.stats.streak,
    winPercent: r.stats.winPercent, gamesBehind: r.stats.gamesBehind,
    pointsFor: r.stats.pointsFor, pointsAgainst: r.stats.pointsAgainst
  };
}

export async function fetchEspnNbaStandings(){
  const rows = await fetchEspnFlatStandings('/apis/v2/sports/basketball/nba/standings');
  return rows ? rows.map(mapNbaLikeRow) : null;
}

export async function fetchEspnWnbaStandings(){
  const rows = await fetchEspnFlatStandings('/apis/v2/sports/basketball/wnba/standings');
  return rows ? rows.map(mapNbaLikeRow) : null;
}

// NHL conference standings — verified live (2026-09-11). Hockey's
// standings are ranked by points (2 per win, 1 per OT/shootout loss),
// not win%, and carry an otLosses field with no equivalent in the other
// sports here — regulation losses get zero points, an OT/shootout loss
// still gets one, so `points` (not wins/losses alone) is what actually
// orders the table.
// Shape returned: [{ id, conference, conferenceAbbr, teamName,
// abbreviation, logoUrl, wins, losses, otLosses, points, streak }]
export async function fetchEspnNhlStandings(){
  const rows = await fetchEspnFlatStandings('/apis/v2/sports/hockey/nhl/standings');
  if(!rows) return null;
  return rows.map(r => ({
    id: r.id, conference: r.conference, conferenceAbbr: r.conferenceAbbr,
    teamName: r.teamName, teamNickname: r.teamNickname, abbreviation: r.abbreviation, logoUrl: r.logoUrl,
    wins: r.stats.wins, losses: r.stats.losses, otLosses: r.stats.otLosses,
    points: r.stats.points, streak: r.stats.streak
  }));
}

// MLB league standings (AL/NL, not "conference" — ESPN's own group
// name/abbreviation are used as-is either way) — verified live
// (2026-09-11). Baseball's win% + games-behind is the real ordering
// convention (not points like NHL); ties are vanishingly rare but the
// field exists on the endpoint, so it's carried through rather than
// assumed zero.
// Shape returned: [{ id, conference, conferenceAbbr, teamName,
// abbreviation, logoUrl, wins, losses, ties, winPercent, gamesBehind,
// streak }]
export async function fetchEspnMlbStandings(){
  const rows = await fetchEspnFlatStandings('/apis/v2/sports/baseball/mlb/standings');
  if(!rows) return null;
  return rows.map(r => ({
    id: r.id, conference: r.conference, conferenceAbbr: r.conferenceAbbr,
    teamName: r.teamName, teamNickname: r.teamNickname, abbreviation: r.abbreviation, logoUrl: r.logoUrl,
    wins: r.stats.wins, losses: r.stats.losses, ties: r.stats.ties,
    winPercent: r.stats.winPercent, gamesBehind: r.stats.gamesBehind, streak: r.stats.streak
  }));
}

// Static, stable structural data — confirmed live (2026-09-11) by
// walking each conference's /children division-group refs on ESPN's
// hypermedia core API. These ids are ESPN's own fixed identifiers for
// the NFL's 8 divisions; they don't change season to season, so no
// need to rediscover them at runtime.
const NFL_DIVISION_GROUP_IDS = {
  'AFC East': 4, 'AFC North': 12, 'AFC South': 13, 'AFC West': 6,
  'NFC East': 1, 'NFC North': 10, 'NFC South': 11, 'NFC West': 3
};

// Real division-by-division standings (AFC East, NFC West, etc.) —
// unlike fetchEspnNflStandings above (one flat request, conference
// only), the "site" API has no division grouping at all, so this
// walks ESPN's other, much more granular hidden API instead: the
// hypermedia "core" API (sports.core.api.espn.com). Confirmed CORS-open
// same as everything else here, but structured as a graph of `$ref`
// links rather than one flat JSON blob, so pulling one division's
// standings takes a fixed chain: conference group -> division group
// (ids hardcoded above, already resolved) -> that division's "overall"
// standings sub-resource, which finally has the real per-team
// win/loss/streak/PF/PA numbers (same field names as the flat
// endpoint's stats). The one thing that sub-resource does NOT have is
// team identity — `entry.team` there is only a further `$ref}` — so
// this also calls the flat endpoint above once to build an id ->
// name/abbreviation/logo lookup, rather than dereferencing all 32 of
// those refs individually (which would mean 32 MORE requests). 9
// requests total (1 flat + 8 divisions), run in parallel. See
// docs/espn-migration-plan.md's "NFL division standings" finding for
// how this chain was originally discovered.
// Shape returned: [{ division, teams: [{ teamId, teamName,
// abbreviation, logoUrl, wins, losses, ties, streak, pointsFor,
// pointsAgainst, winPercent }] }] — one entry per division, in the
// fixed AFC East/North/South/West, NFC East/North/South/West order
// above.
export async function fetchEspnNflDivisionStandings(){
  const flatRows = await fetchEspnNflStandings();
  if(!flatRows) return null;

  const byId = {};
  flatRows.forEach(row => { byId[row.id] = row; });

  const seasonYear = new Date().getFullYear();
  const divisions = await Promise.all(
    Object.entries(NFL_DIVISION_GROUP_IDS).map(async ([division, groupId]) => {
      const data = await fetchEspnCoreJSON(
        `${ESPN_CORE_BASE}/v2/sports/football/leagues/nfl/seasons/${seasonYear}/types/2/groups/${groupId}/standings/0?lang=en&region=us`
      );
      const entries = (data && data.standings) || [];
      const teams = entries.map(entry => {
        const idMatch = /\/teams\/(\d+)/.exec((entry.team && entry.team.$ref) || '');
        const teamId = idMatch ? idMatch[1] : null;
        const known = teamId ? byId[teamId] : null;
        const overall = (entry.records || []).find(r => r.name === 'overall');
        const stat = name => {
          const s = (overall && overall.stats || []).find(x => x.name === name);
          return s ? s.value : null;
        };
        return {
          teamId,
          teamName: known ? known.teamName : null,
          teamNickname: known ? known.teamNickname : null,
          abbreviation: known ? known.abbreviation : null,
          logoUrl: known ? known.logoUrl : null,
          wins: stat('wins'),
          losses: stat('losses'),
          ties: stat('ties'),
          streak: stat('streak'),
          pointsFor: stat('pointsFor'),
          pointsAgainst: stat('pointsAgainst'),
          winPercent: stat('winPercent')
        };
      // Drop anything the id lookup failed to resolve rather than
      // rendering a nameless row — should only happen if ESPN adds a
      // 33rd team mid-season without this app knowing about it yet.
      }).filter(t => t.abbreviation);
      return { division, teams };
    })
  );
  // A division fetch that came back empty (one bad request out of 9)
  // shouldn't take out the whole standings view — surface it as a
  // division with no teams rather than failing the entire result.
  return divisions;
}

// Real AP Top 25 (or any of ESPN's other 4 CFB polls — Coaches, FCS
// Coaches, D2/D3 Coaches — pass its exact `name` from the `rankings`
// array). Richer than TheRundown's flat 1-25 "ranking" field: also
// carries week-over-week trend, first-place votes, and poll points.
// Shape returned: [{ rank, previousRank, trend, teamName, location,
// logoUrl, record, points, firstPlaceVotes }]
export async function fetchEspnCfbRankings(pollName = 'AP Top 25'){
  const data = await fetchEspnJSON('/apis/site/v2/sports/football/college-football/rankings');
  if(!data || !Array.isArray(data.rankings)) return null;

  const poll = data.rankings.find(p => p.name === pollName);
  if(!poll || !Array.isArray(poll.ranks)) return null;

  return poll.ranks.map(r => ({
    rank: r.current,
    previousRank: r.previous,
    trend: r.trend,
    teamName: espnTeamName(r.team),
    location: r.team.location,
    logoUrl: espnLogoUrl(r.team),
    record: r.recordSummary,
    points: r.points,
    firstPlaceVotes: r.firstPlaceVotes
  }));
}

// Every FBS team's real win-loss record, across all 11 conferences —
// verified live (2026-09-12): 124 FBS teams. This is what used to need
// TheRundown's /teams/{sportId} (js/standings-cfb.js's cfbRecordsCache):
// board card record, the team modal stat strip, and the "Person"
// combined-win% view. One real gap this doesn't cover — FBS only, no
// FCS — matters for exactly one of this app's drafted CFB teams (NDSU);
// see findCfbRecord in js/standings-cfb.js for the ESPN-first,
// TheRundown-fallback-for-anything-ESPN-doesn't-have approach that
// covers it without keeping the other 29 CFB teams on TheRundown too.
// No conference grouping needed here (unlike fetchEspnFlatStandings's
// NFL/NBA/etc use) — CFB's own "League" view is the AP Top 25
// (fetchEspnCfbRankings above), not a conference standings table, so
// this flattens every conference straight into one array.
// Matches by `location` (e.g. "Ohio State"), the same field
// fetchEspnCfbRankings already uses — reuses that exact matching
// approach (findCfbTeamKeyByEspnLocation) rather than a second one.
// Shape returned: [{ id, location, teamName, wins, losses }]
export async function fetchEspnCfbFullStandings(){
  const data = await fetchEspnJSON('/apis/v2/sports/football/college-football/standings');
  if(!data || !Array.isArray(data.children)) return null;

  const rows = [];
  data.children.forEach(conf => {
    const entries = (conf.standings && conf.standings.entries) || [];
    entries.forEach(entry => {
      // Unlike NFL/NBA/NHL/MLB, CFB's stats array has no flat "losses"
      // field at all — confirmed live (2026-09-12), Oregon's array has
      // wins=1 but nothing named "losses". What it does have is several
      // named per-split records (home/division/vs-AP-ranked/etc, each
      // with its own `summary` like "1-0"), one of which is `overall` —
      // that's the real season record, parsed the same "W-L" string way
      // parseWinLossRecord (js/standings-cfb.js) already parses
      // TheRundown's identically-shaped record string.
      const overall = (entry.stats || []).find(s => s.name === 'overall');
      const m = overall && /^(\d+)-(\d+)/.exec(overall.summary || '');
      if(!m) return;
      rows.push({
        id: entry.team.id,
        location: entry.team.location,
        teamName: espnTeamName(entry.team),
        wins: parseInt(m[1], 10),
        losses: parseInt(m[2], 10)
      });
    });
  });
  return rows;
}

// Real EPL table, all 20 clubs — verified live (2026-09-11): carries
// every field the old TheSportsDB-sourced table did (rank/win/draw/
// loss/points), plus fields TheSportsDB's table never had at all —
// goalsFor/goalsAgainst, goalDifference, gamesPlayed, and a
// qualification/relegation "zone" tag (e.g. "Champions League",
// "Relegation") straight from ESPN's own `note` field. A single-table
// league like the EPL only has one standings type, so (unlike NFL's
// conference split) this reads `children[0]` rather than mapping over
// several groups.
// Shape returned: [{ id, teamName, abbreviation, logoUrl, rank, wins,
// draws, losses, points, gamesPlayed, goalDifference, goalsFor,
// goalsAgainst, zone }]
export async function fetchEspnEplStandings(){
  const data = await fetchEspnJSON('/apis/v2/sports/soccer/eng.1/standings');
  const entries = data && data.children && data.children[0] && data.children[0].standings && data.children[0].standings.entries;
  if(!Array.isArray(entries)) return null;

  return entries.map(entry => {
    const stat = name => {
      const s = (entry.stats || []).find(x => x.name === name);
      return s ? s.value : null;
    };
    return {
      id: entry.team.id,
      teamName: espnTeamName(entry.team),
      abbreviation: entry.team.abbreviation,
      logoUrl: espnLogoUrl(entry.team),
      rank: stat('rank'),
      wins: stat('wins'),
      draws: stat('ties'),
      losses: stat('losses'),
      points: stat('points'),
      gamesPlayed: stat('gamesPlayed'),
      goalDifference: stat('pointDifferential'),
      goalsFor: stat('pointsFor'),
      goalsAgainst: stat('pointsAgainst'),
      zone: entry.note ? entry.note.description : null,
      // ESPN's own note.color is occasionally malformed — confirmed live,
      // Europa League came back as "##B5E7CE" (double leading #) while
      // Champions League/Relegation were fine — so this strips however
      // many #'s are actually there and adds back exactly one.
      zoneColor: entry.note && entry.note.color ? '#' + entry.note.color.replace(/^#+/, '') : null
    };
  });
}

// A club's real schedule — past results and every remaining fixture —
// verified live (2026-09-11) against Liverpool. ESPN's team schedule
// endpoint defaults to this season's played matches only (`recent`
// below); the same endpoint with `?fixture=true` instead returns every
// remaining fixture, not just the next one (`upcoming` below). Neither
// needs a second "team detail" call to know the next match id the way
// TheSportsDB V2's separate schedule-previous/schedule-next calls did.
// Carries real venue names and TV broadcast info, which TheSportsDB
// never had at all — see js/live-data.js's renderForm/renderNext for
// where those show up.
// Shape returned: { recent, upcoming }, each an array of
// [{ id, date, completed, statusDetail, isHome, opponentName,
// opponentLogoUrl, ownScore, oppScore, venueName, broadcast }],
// recent newest-first, upcoming soonest-first.
// Generalized for every league that uses this same "site" API team-
// schedule shape (soccer/eng.1 for EPL, basketball/nba, hockey/nhl,
// baseball/mlb, basketball/wnba so far) — the ?fixture=true flag's
// actual behavior turned out to differ by sport, checked live
// (2026-09-12): for EPL it genuinely splits (default = played matches
// only, ?fixture=true = remaining fixtures only), but for MLB both
// calls return the SAME full ~165-game season either way. Rather than
// trust that split, this fetches both, merges by event id (harmless
// duplicate work for MLB, necessary for EPL), and does the real
// recent/upcoming split itself off each event's own `completed` flag —
// correct regardless of which behavior a given sport turns out to have.
// Shape returned: { recent, upcoming }, each an array of
// [{ id, date, completed, statusDetail, isHome, opponentName,
// opponentLogoUrl, ownScore, oppScore, venueName, broadcast }],
// recent newest-first, upcoming soonest-first.
export async function fetchEspnTeamSchedule(sportLeaguePath, espnTeamId){
  const normalize = event => {
    const comp = event.competitions && event.competitions[0];
    const competitors = (comp && comp.competitors) || [];
    const self = competitors.find(c => c.team && String(c.team.id) === String(espnTeamId));
    const opponent = competitors.find(c => c.team && String(c.team.id) !== String(espnTeamId));
    if(!self || !opponent) return null;
    const statusType = comp.status && comp.status.type;
    const broadcast = comp.broadcasts && comp.broadcasts[0];
    return {
      id: event.id,
      date: event.date,
      completed: !!(statusType && statusType.completed),
      statusDetail: statusType ? statusType.shortDetail : null,
      isHome: self.homeAway === 'home',
      opponentName: espnTeamName(opponent.team),
      opponentLogoUrl: espnLogoUrl(opponent.team),
      ownScore: self.score ? Number(self.score.displayValue) : null,
      oppScore: opponent.score ? Number(opponent.score.displayValue) : null,
      venueName: comp.venue ? comp.venue.fullName : null,
      broadcast: broadcast && broadcast.media ? broadcast.media.shortName : null
    };
  };

  const [a, b] = await Promise.all([
    fetchEspnJSON(`/apis/site/v2/sports/${sportLeaguePath}/teams/${espnTeamId}/schedule`),
    fetchEspnJSON(`/apis/site/v2/sports/${sportLeaguePath}/teams/${espnTeamId}/schedule?fixture=true`)
  ]);
  const byId = new Map();
  [...((a && a.events) || []), ...((b && b.events) || [])].forEach(event => {
    const normalized = normalize(event);
    if(normalized) byId.set(normalized.id, normalized);
  });
  const all = [...byId.values()];
  const now = Date.now();
  const recent = all.filter(e => e.completed).sort((x, y) => new Date(y.date) - new Date(x.date));
  // A postponed game (real, confirmed live on the Cubs' schedule —
  // several April/June 2026 games marked STATUS_POSTPONED) is
  // "incomplete" forever but dated months in the past — without this
  // date guard it would sort to the front of "upcoming" ahead of every
  // real future game. Live-in-progress games never reach this: those
  // are handled earlier by TheRundown's overlay (isRundownEventLive),
  // so excluding a past date here never hides a game actually in
  // progress right now.
  const upcoming = all.filter(e => !e.completed && new Date(e.date).getTime() >= now)
    .sort((x, y) => new Date(x.date) - new Date(y.date));
  return { recent, upcoming };
}

// Today's full slate for a league (one request covers every team in
// it, same "one shared fetch" idea as rundownDayCache in js/api.js) —
// this is what replaces TheRundown for live in-game state. Verified
// live (2026-09-12) against 4 actually-in-progress MLB games: a
// STATUS_IN_PROGRESS competition's `status.type.state` is `'in'`
// (`'pre'`/`'post'` otherwise), and each competitor already carries a
// live `score` — no separate polling endpoint needed, this one
// response has today's state for every game at once.
// Shape returned: [{ id, state, detail, completed, competitors:
// [{ teamId, teamName, homeAway, score }] }]
export async function fetchEspnScoreboard(sportLeaguePath){
  const data = await fetchEspnJSON(`/apis/site/v2/sports/${sportLeaguePath}/scoreboard`);
  if(!data || !Array.isArray(data.events)) return null;

  return data.events.map(event => {
    const comp = event.competitions && event.competitions[0];
    if(!comp) return null;
    const statusType = comp.status && comp.status.type;
    const competitors = (comp.competitors || []).map(c => ({
      teamId: c.team && c.team.id,
      teamName: espnTeamName(c.team),
      homeAway: c.homeAway,
      score: (c.score !== undefined && c.score !== null) ? Number(c.score) : null
    }));
    return {
      id: event.id,
      state: statusType ? statusType.state : null,
      detail: statusType ? statusType.shortDetail : null,
      completed: !!(statusType && statusType.completed),
      competitors
    };
  }).filter(Boolean);
}

// Given today's scoreboard (fetchEspnScoreboard above) and one team's
// ESPN id, the same {isHome, own, opp, opponentName, period} shape
// rundownEventLine (js/api.js) builds from TheRundown — so
// renderStats/renderForm/renderNext/renderRowStatus (js/live-data.js)
// can read either source through one interface. `isLive` is state==='in'
// specifically, not just "found an event" — a scheduled-later-today or
// already-final game still returns a line (its score/detail), just
// with isLive:false, so callers can still show "Final 7-2" from the
// same lookup instead of needing a separate completed-game code path.
export function findEspnScoreboardLine(events, espnTeamId){
  if(!events) return null;
  const event = events.find(e => e.competitors.some(c => String(c.teamId) === String(espnTeamId)));
  if(!event) return null;
  const self = event.competitors.find(c => String(c.teamId) === String(espnTeamId));
  const opponent = event.competitors.find(c => String(c.teamId) !== String(espnTeamId));
  if(!self || !opponent) return null;
  return {
    isLive: event.state === 'in',
    completed: event.completed,
    isHome: self.homeAway === 'home',
    own: self.score,
    opp: opponent.score,
    opponentName: opponent.teamName,
    period: event.detail
  };
}
