/* ============================================================
   NHL Standings: real conference standings (East/West), each nested
   with a real Division breakdown (Atlantic/Metropolitan/Central/
   Pacific — see fetchEspnNhlDivisionStandings in js/espn.js), plus each
   drafter's combined record across their NHL teams. No standings
   source existed for this league before ESPN either.
   Hockey ranks by points (2 per win, 1 per OT/shootout loss), not win
   percentage — a regulation loss earns nothing, but an OT/shootout
   loss still earns a point, so this sorts and combines on `points`
   throughout rather than deriving a percentage the way NBA/MLB/WNBA do.
   ============================================================ */
import { fetchEspnNhlStandings, fetchEspnNhlDivisionStandings } from './espn.js';
import { createFlatStandingsBoard } from './standings-flat.js';

const board = createFlatStandingsBoard({
  leagueKey: 'nhl',
  cacheKey: 'teamDashboardEspnNhlStandingsCache',
  ttlMs: 60 * 60 * 1000,
  fetchStandings: fetchEspnNhlStandings,
  fetchDivisionStandings: fetchEspnNhlDivisionStandings,
  conferences: [
    { abbr: 'East', mode: 'east', label: 'East' },
    { abbr: 'West', mode: 'west', label: 'West' }
  ],
  recordLabel: row => `${row.wins}-${row.losses}-${row.otLosses || 0} &middot; ${row.points} pts`,
  sortConference: (a, b) => {
    const pa = a.points ?? -1, pb = b.points ?? -1;
    if(pb !== pa) return pb - pa;
    return a.teamName.localeCompare(b.teamName);
  },
  combinedInit: () => ({ wins: 0, losses: 0, otLosses: 0, points: 0 }),
  combinedAccumulate: (bucket, row) => {
    bucket.wins += row.wins || 0;
    bucket.losses += row.losses || 0;
    bucket.otLosses += row.otLosses || 0;
    bucket.points += row.points || 0;
  },
  combinedLabel: row => `${row.wins}-${row.losses}-${row.otLosses} &middot; ${row.points} pts`,
  combinedSort: (a, b) => b.points - a.points
});

export const espnNhlStandingsCache = board.cache;
export const loadEspnNhlStandingsCache = board.load;
export const fetchEspnNhlStandingsCached = board.fetchCached;
export const nhlRecordLabel = board.cardRecordLabel;
export const renderAllNhlCardRecords = board.renderAllCardRecords;
export const findEspnNhlRow = board.findRowForMeta;
export const computeNhlConferenceStandings = board.computeConferenceStandings;
export const renderNhlStandingsRow = board.renderStandingsRow;
export const computeNhlDrafterCombined = board.computeDrafterCombined;
export const renderNhlByDrafterRow = board.renderByDrafterRow;
export const nhlStandingsToggleHtml = board.toggleHtml;
export function getNhlStandingsMode(){ return board.getMode(); }
export const nhlConferences = board.conferences;
export const nhlHasDivisions = board.hasDivisions;
export const espnNhlDivisionCache = board.divisionCache;
export const loadEspnNhlDivisionCache = board.loadDivisionCache;
export const fetchEspnNhlDivisionStandingsCached = board.fetchDivisionCached;
export const computeNhlDivisionStandings = board.computeDivisionStandings;
export const renderNhlGroupHeader = board.renderGroupHeader;
export function getNhlConferenceSubMode(){ return board.getConferenceSubMode(); }
export const nhlDivisionLabel = board.divisionLabel;
