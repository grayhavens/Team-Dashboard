/* ============================================================
   Generic helpers shared across the other js/ modules: network
   fetch, formatting, modal scroll-lock, team-name matching, and
   the small badge/icon markup every view reuses.
   ============================================================ */
import { LEAGUES, TEAM_META } from './data.js';

export async function fetchJSON(url){
  try {
    const res = await fetch(url);
    if(!res.ok) return null;
    return await res.json();
  } catch (e){
    return null;
  }
}

export function ordinal(n){
  n = parseInt(n, 10);
  if(isNaN(n)) return '—';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatKickoff(iso){
  if(!iso) return '';
  const d = new Date(iso.includes('Z') ? iso : iso + 'Z');
  if(isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export function formatUpdatedAt(date){
  if(!date) return '';
  // Uses the viewer's own clock, shown in Central time either way
  // (CST or CDT, whichever is actually in effect).
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago', timeZoneName: 'short' });
}

// Mirrors the drafter/league/data-mode/tab selections into the URL's
// query string (?team=, ?league=, ?data=, ?view=) via
// history.replaceState — no reload, no new back-button entries — so a
// bookmark captures exactly what was on screen when it was saved, not
// just whatever this one browser's localStorage remembers. Each setter
// (setDraftTeam, setStandingsFilter, setObMode, switchView) calls this
// with its own key; a null value removes that param so the default,
// un-bookmarked state stays a clean URL with no query string at all.
export function updateUrlParam(key, value){
  try {
    const url = new URL(window.location.href);
    if(value === null || value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    window.history.replaceState(null, '', url);
  } catch (e){
    // URL/history unavailable (very old browser, sandboxed iframe,
    // etc.) — the app still works, it just won't be bookmarkable.
  }
}

// ---- Modal scroll lock ----
// Pins the page in place behind the modal (rather than just hiding
// overflow) so iOS Safari can't rubber-band-scroll the background
// while a modal is open. Restores the exact scroll position on close.
let lockedScrollY = 0;

export function lockBodyScroll(){
  lockedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.width = '100%';
}

export function unlockBodyScroll(){
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, lockedScrollY);
}

// A few real club names don't match our shorthand roster names
// (e.g. "Man City" vs the API's "Manchester City") — normalize both
// sides before comparing so "Drafted by" still finds the right owner.
const TEAM_NAME_ALIASES = {
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  'spurs': 'tottenham hotspur',
  'afc bournemouth': 'bournemouth'
};

export function normalizeTeamName(name){
  let n = (name || '').toLowerCase().trim().replace(/\bafc\b/g, '').replace(/\bfc\b/g, '').replace(/\s+/g, ' ').trim();
  return TEAM_NAME_ALIASES[n] || n;
}

export function findDraftedTeamByName(leagueKey, realName){
  const league = LEAGUES.find(l => l.key === leagueKey);
  if(!league) return null;
  const target = normalizeTeamName(realName);
  return league.teams.find(teamKey => {
    const candidate = normalizeTeamName(TEAM_META[teamKey].name);
    return candidate === target || target.includes(candidate) || candidate.includes(target);
  }) || null;
}

export function abbrFromName(name){
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  if(words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().slice(0, 4);
  return (name || '').toUpperCase().slice(0, 3);
}

export const CLOSE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6L18 18"></path><path d="M18 6L6 18"></path></svg>';
export const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#0A0B0D" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"></path></svg>';
export const CHEVRON_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>';

// Renders a team's badge: the real crest image when meta.badgeUrl is
// set, layered over the same colored-monogram box every team already
// has — that box stays as the fallback (onerror removes the img,
// revealing it) since hotlinked images can occasionally fail to load,
// and it's what every team without a badgeUrl yet still uses as-is.
export function teamBadgeHtml(meta){
  if(meta.badgeUrl){
    // Real crests are transparent PNGs meant to sit on a light backdrop.
    // Putting one over the team's own accent color looked fine for most
    // teams, but broke badly for e.g. Liverpool — an all-red crest over
    // Liverpool's near-identical red background was nearly invisible.
    // White background instead, consistent regardless of a team's own
    // brand color. data-fallback-* carries the original colored-monogram
    // look over to the onerror handler, restored only if the hotlinked
    // image actually fails to load.
    return `<div class="badge badge-crest"><img src="${meta.badgeUrl}" alt="${meta.name}" data-fallback-style="${meta.badgeStyle}" data-fallback-text="${meta.badgeText}" onerror="const p=this.parentElement; p.className='badge'; p.setAttribute('style', this.dataset.fallbackStyle); p.textContent=this.dataset.fallbackText;"></div>`;
  }
  return `<div class="badge" style="${meta.badgeStyle}">${meta.badgeText}</div>`;
}
