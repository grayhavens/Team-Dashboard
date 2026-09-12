/* ============================================================
   MLB Standings: real league standings (AL/NL — ESPN's own group name,
   not "conference") plus each drafter's combined win percentage across
   their MLB teams. No standings source existed for this league before
   ESPN either. Ties are vanishingly rare in modern MLB but the field
   exists on ESPN's endpoint, so it's carried through rather than
   assumed zero (same reasoning as NFL's ties field).
   ============================================================ */
import { fetchEspnMlbStandings } from './espn.js';
import { createFlatStandingsBoard } from './standings-flat.js';

function winPct(b){
  const total = b.wins + b.losses + b.ties;
  return total > 0 ? (b.wins + b.ties * 0.5) / total : null;
}

const board = createFlatStandingsBoard({
  leagueKey: 'mlb',
  cacheKey: 'teamDashboardEspnMlbStandingsCache',
  ttlMs: 60 * 60 * 1000,
  fetchStandings: fetchEspnMlbStandings,
  conferences: [
    { abbr: 'AL', mode: 'al', label: 'AL' },
    { abbr: 'NL', mode: 'nl', label: 'NL' }
  ],
  recordLabel: row => `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}`,
  sortConference: (a, b) => {
    const pa = a.winPercent ?? -1, pb = b.winPercent ?? -1;
    if(pb !== pa) return pb - pa;
    return a.teamName.localeCompare(b.teamName);
  },
  combinedInit: () => ({ wins: 0, losses: 0, ties: 0 }),
  combinedAccumulate: (bucket, row) => {
    bucket.wins += row.wins || 0;
    bucket.losses += row.losses || 0;
    bucket.ties += row.ties || 0;
  },
  combinedLabel: row => {
    const pct = winPct(row);
    return `${row.wins}-${row.losses}${row.ties ? '-' + row.ties : ''}${pct !== null ? ` &middot; ${Math.round(pct * 100)}%` : ''}`;
  },
  combinedSort: (a, b) => {
    const pa = winPct(a) ?? -1, pb = winPct(b) ?? -1;
    if(pb !== pa) return pb - pa;
    return b.wins - a.wins;
  }
});

export const espnMlbStandingsCache = board.cache;
export const loadEspnMlbStandingsCache = board.load;
export const fetchEspnMlbStandingsCached = board.fetchCached;
export const mlbRecordLabel = board.cardRecordLabel;
export const renderAllMlbCardRecords = board.renderAllCardRecords;
export const findEspnMlbRow = board.findRowForMeta;
export const computeMlbConferenceStandings = board.computeConferenceStandings;
export const renderMlbStandingsRow = board.renderStandingsRow;
export const computeMlbDrafterCombined = board.computeDrafterCombined;
export const renderMlbByDrafterRow = board.renderByDrafterRow;
export const mlbStandingsToggleHtml = board.toggleHtml;
export function getMlbStandingsMode(){ return board.getMode(); }
export const mlbConferences = board.conferences;
