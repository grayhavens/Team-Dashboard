/* ============================================================
   WNBA Standings: same shape as NBA (js/standings-nba.js) — real
   conference standings (East/West) plus each drafter's combined win
   percentage across their WNBA teams. No standings source existed for
   this league before ESPN either.
   ============================================================ */
import { fetchEspnWnbaStandings } from './espn.js';
import { createFlatStandingsBoard } from './standings-flat.js';

function winPct(b){
  return (b.wins + b.losses) > 0 ? b.wins / (b.wins + b.losses) : null;
}

const board = createFlatStandingsBoard({
  leagueKey: 'wnba',
  cacheKey: 'teamDashboardEspnWnbaStandingsCache',
  ttlMs: 60 * 60 * 1000,
  fetchStandings: fetchEspnWnbaStandings,
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

export const espnWnbaStandingsCache = board.cache;
export const loadEspnWnbaStandingsCache = board.load;
export const fetchEspnWnbaStandingsCached = board.fetchCached;
export const wnbaRecordLabel = board.cardRecordLabel;
export const renderAllWnbaCardRecords = board.renderAllCardRecords;
export const findEspnWnbaRow = board.findRowForMeta;
export const computeWnbaConferenceStandings = board.computeConferenceStandings;
export const renderWnbaStandingsRow = board.renderStandingsRow;
export const computeWnbaDrafterCombined = board.computeDrafterCombined;
export const renderWnbaByDrafterRow = board.renderByDrafterRow;
export const wnbaStandingsToggleHtml = board.toggleHtml;
export function getWnbaStandingsMode(){ return board.getMode(); }
export const wnbaConferences = board.conferences;
