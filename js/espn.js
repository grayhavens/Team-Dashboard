/* ============================================================
   ESPN HIDDEN API — Phase 1 pilot (see docs/espn-migration-plan.md
   for the full evaluation and proposed rollout).

   ESPN's undocumented site API (site.web.api.espn.com — confirmed
   byte-identical to the older site.api.espn.com for shared paths, so
   this uses the .web. host going forward) serves real standings/
   rankings data with open CORS and no API key, unlike the two
   sources this app currently stitches together:
     - TheSportsDB has NO standings endpoint at all for NFL or CFB
       (lookuptable.php confirmed empty, every season tested).
     - TheRundown fills that gap today (js/standings-cfb.js,
       js/standings-nfl.js) but is paid/metered — a shared 20,000
       data-points/day budget across all 8 leagues that ran out
       entirely on 2026-09-11 (confirmed via the worker: 429 "Daily
       data point limit reached", used: 20018), taking down CFB
       ranks, NFL standings, and live in-game state for everyone
       until the quota resets.

   This module is the Phase 1 pilot ONLY: it fetches and normalizes
   NFL standings + CFB rankings from ESPN and has been verified
   field-for-field against live ESPN data (see the plan doc's Pilot
   Results section), but it is NOT YET IMPORTED anywhere — wiring it
   into js/standings-nfl.js / js/standings-cfb.js in place of the
   TheRundown calls is Phase 2, deliberately left for a follow-up
   change once this pilot itself is reviewed, per this repo's
   "pilot on 2-3 examples, diff against known-good, THEN roll out"
   convention (see V2_MIGRATED_LEAGUES in js/api.js).

   No worker proxy needed for either function below — both endpoints
   returned `access-control-allow-origin: *` when queried with this
   app's real Origin header, so (unlike TheSportsDB V2 and TheRundown)
   these can be fetched straight from the browser. The one ESPN
   endpoint that does need a server-side call is the bulk
   /teams?limit=1000 list used to build a name/ID mapping table — it
   has no CORS headers at all, but that's a one-time offline lookup
   (via curl), never something this client code calls at runtime.
   ============================================================ */

export const ESPN_SITE_BASE = 'https://site.web.api.espn.com';

async function fetchEspnJSON(path){
  try {
    const res = await fetch(`${ESPN_SITE_BASE}${path}`);
    if(!res.ok) return null;
    return await res.json();
  } catch (e){
    return null;
  }
}

// CONFERENCE-level standings only (32 teams split AFC/NFC) — verified
// live against actual results (e.g. Seattle showed 1-0/Rams 0-1
// immediately after their Week 1 final, while teams that hadn't
// played yet correctly still showed 0-0), so what it does return is
// fresh and correct, not just structurally plausible.
//
// IMPORTANT — this does NOT include division grouping, despite that
// being assumed during initial evaluation. entry.team carries no
// division field on this endpoint; ESPN's site API only nests
// standings one level (by conference). True division-by-division
// standings (AFC North, NFC West, etc. — what js/standings-nfl.js's
// TheRundown-based version currently shows) live behind the
// hypermedia "core" API instead (sports.core.api.espn.com) and need a
// multi-hop fetch chain: conference group -> 4 division-group refs
// each -> each division's "overall" standings sub-resource -> a
// records array per team (win/loss IS embedded there) but team
// identity is itself a further $ref, so it also needs a one-time
// static ESPN-team-id -> name/abbreviation table (same pattern as
// this app's existing sportsdbId/rundownTeamId fields) to avoid 32
// more per-team fetches on every refresh. See docs/espn-migration-plan.md's
// "NFL division standings" finding for the confirmed group IDs and
// the full chain — this is real and works, just a materially bigger
// build than this flat conference endpoint, so it's left unimplemented
// here pending a decision on whether it's worth it over Phase 2's
// simpler "conference-only, drop the division grouping" option.
// Shape returned: [{ conference, conferenceAbbr, teamName, abbreviation,
// wins, losses, ties, streak, pointsFor, pointsAgainst, winPercent }]
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
        conference: conf.name,
        conferenceAbbr: conf.abbreviation,
        teamName: entry.team.displayName,
        abbreviation: entry.team.abbreviation,
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

// Real AP Top 25 (or any of ESPN's other 4 CFB polls — Coaches, FCS
// Coaches, D2/D3 Coaches — pass its exact `name` from the `rankings`
// array). Richer than TheRundown's flat 1-25 "ranking" field: also
// carries week-over-week trend, first-place votes, and poll points.
// Shape returned: [{ rank, previousRank, trend, teamName, location,
// record, points, firstPlaceVotes }]
export async function fetchEspnCfbRankings(pollName = 'AP Top 25'){
  const data = await fetchEspnJSON('/apis/site/v2/sports/football/college-football/rankings');
  if(!data || !Array.isArray(data.rankings)) return null;

  const poll = data.rankings.find(p => p.name === pollName);
  if(!poll || !Array.isArray(poll.ranks)) return null;

  return poll.ranks.map(r => ({
    rank: r.current,
    previousRank: r.previous,
    trend: r.trend,
    teamName: r.team.displayName,
    location: r.team.location,
    record: r.recordSummary,
    points: r.points,
    firstPlaceVotes: r.firstPlaceVotes
  }));
}
