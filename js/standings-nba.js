/* ============================================================
   NBA Standings: real conference standings (East/West) plus each
   drafter's combined win percentage across their 3 NBA teams — this
   league had NO standings source at all before ESPN (TheSportsDB's
   free/V1 tier has never carried real NBA standings), so unlike EPL/
   CFB/NFL this isn't replacing a shakier existing source, it's turning
   on a tab that previously just said "No data available."
   Shares its cache/toggle/render engine with NHL/MLB/WNBA — see
   createFlatStandingsBoard in js/standings-flat.js for what's generic
   and what's sport-specific below.
   ============================================================ */
import { fetchEspnNbaStandings } from './espn.js';
import { createFlatStandingsBoard } from './standings-flat.js';

// Win percentage isn't carried on the combined bucket itself — derived
// here from whatever's been summed so far, so a still-winless-but-
// untested drafter (0 games) doesn't outrank one who hasn't played at
// all (also 0, but for a different reason) — both get -1, sorted last.
function winPct(b){
  return (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : null;
}

const board = createFlatStandingsBoard({
  leagueKey: 'nba',
  cacheKey: 'teamDashboardEspnNbaStandingsCache',
  ttlMs: 60 * 60 * 1000,
  fetchStandings: fetchEspnNbaStandings,
  conferences: [
    { abbr: 'East', mode: 'east', label: 'East' },
    { abbr: 'West', mode: 'west', label: 'West' }
  ],
  recordLabel: row => `${row.wins}-${row.losses}`,
  sortConference: (a, b) => {
    const pa = a.winPercent ?? -1, pb = b.winPercent ?? -1;
    if(pb !== pa) return pb - pa;
    return a.teamName.localeCompare(b.teamName);
  },
  combinedInit: () => ({ wins: 0, losses: 0 }),
  combinedAccumulate: (bucket, row) => {
    bucket.wins += row.wins || 0;
    bucket.losses += row.losses || 0;
  },
  combinedLabel: row => {
    const pct = winPct(row);
    return `${row.wins}-${row.losses}${pct !== null ? ` &middot; ${Math.round(pct * 100)}%` : ''}`;
  },
  combinedSort: (a, b) => {
    const pa = winPct(a) ?? -1, pb = winPct(b) ?? -1;
    if(pb !== pa) return pb - pa;
    return b.wins - a.wins;
  }
});

export const espnNbaStandingsCache = board.cache;
export const loadEspnNbaStandingsCache = board.load;
export const fetchEspnNbaStandingsCached = board.fetchCached;
export const nbaRecordLabel = board.cardRecordLabel;
export const renderAllNbaCardRecords = board.renderAllCardRecords;
export const findEspnNbaRow = board.findRowForMeta;
export const computeNbaConferenceStandings = board.computeConferenceStandings;
export const renderNbaStandingsRow = board.renderStandingsRow;
export const computeNbaDrafterCombined = board.computeDrafterCombined;
export const renderNbaByDrafterRow = board.renderByDrafterRow;
export const nbaStandingsToggleHtml = board.toggleHtml;
export function getNbaStandingsMode(){ return board.getMode(); }
export const nbaConferences = board.conferences;
