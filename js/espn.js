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
  const data = await fetchEspnJSON('/apis/v2/sports/football/nfl/standings');
  if(!data || !Array.isArray(data.children)) return null;

  const rows = [];
  data.children.forEach(conf => {
    const entries = (conf.standings && conf.standings.entries) || [];
    entries.forEach(entry => {
      const stat = name => {
        const s = (entry.stats || []).find(x => x.name === name);
        return s ? s.value : null;
      };
      rows.push({
        id: entry.team.id,
        conference: conf.name,
        conferenceAbbr: conf.abbreviation,
        teamName: espnTeamName(entry.team),
        abbreviation: entry.team.abbreviation,
        logoUrl: espnLogoUrl(entry.team),
        wins: stat('wins'),
        losses: stat('losses'),
        ties: stat('ties'),
        streak: stat('streak'),
        pointsFor: stat('pointsFor'),
        pointsAgainst: stat('pointsAgainst'),
        winPercent: stat('winPercent')
      });
    });
  });
  return rows;
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
export async function fetchEspnEplTeamSchedule(espnTeamId){
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

  const [recentData, upcomingData] = await Promise.all([
    fetchEspnJSON(`/apis/site/v2/sports/soccer/eng.1/teams/${espnTeamId}/schedule`),
    fetchEspnJSON(`/apis/site/v2/sports/soccer/eng.1/teams/${espnTeamId}/schedule?fixture=true`)
  ]);
  const recent = ((recentData && recentData.events) || []).map(normalize).filter(Boolean);
  const upcoming = ((upcomingData && upcomingData.events) || []).map(normalize).filter(Boolean);
  recent.sort((a, b) => new Date(b.date) - new Date(a.date));
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  return { recent, upcoming };
}
