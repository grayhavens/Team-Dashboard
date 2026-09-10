/* ============================================================
   DASHBOARD WORKER (Cloudflare Worker)

   Two unrelated jobs live here, both because they need something
   server-side that GitHub Pages (pure static hosting) can't do:

   1. THERUNDOWN PROXY — TheRundown's API key is personal to your
      account and must never ship in client-side JS (unlike
      TheSportsDB's public "123" test key) — see
      https://docs.therundown.io/authentication. This holds that key
      server-side as a secret and forwards a small allowlist of
      read-only requests to TheRundown on the dashboard's behalf.

   2. LEAGUE FACTS STORE — the "who won the FA Cup" style facts
      marked from the Results modal need to be visible to everyone
      looking at the dashboard, not just saved in one person's
      browser (localStorage can't do that). This stores one JSON
      blob per league in Workers KV and hands it back to whoever
      asks. There's deliberately no auth on writes — this is a
      friend-group scoring app, not anything sensitive — so anyone
      who finds the endpoint could overwrite it. Add a shared secret
      here later if that ever becomes an actual problem.

   Deploy (from this worker/ directory):
     npx wrangler login
     npx wrangler secret put THERUNDOWN_API_KEY
     npx wrangler kv namespace create LEAGUE_FACTS
     (paste the printed id into wrangler.toml's kv_namespaces block)
     npx wrangler deploy
   Then set RUNDOWN_PROXY_BASE in js/app.js to the deployed
   *.workers.dev URL wrangler prints out.
   ============================================================ */

const RUNDOWN_BASE = 'https://api.therundown.io/api/v2';

// Update this list if the dashboard's deployed origin changes (e.g. a
// custom domain). The localhost entry is only here for local dev preview
// and is harmless in production — it just lets a local `python -m
// http.server` load this worker too.
const ALLOWED_ORIGINS = [
  'https://grayhavens.github.io',
  'http://localhost:8934'
];

// League keys that are allowed to have a facts blob — mirrors the
// leagueKey values in js/data.js. Keeping an allowlist here (rather
// than accepting any string) keeps the KV keyspace bounded.
const KNOWN_LEAGUES = ['epl', 'nfl', 'nba', 'nhl', 'mlb', 'wnba', 'cfb', 'mcbb'];

function corsHeaders(origin){
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(data, status, headers){
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function proxyToRundown(rundownPath, env, headers){
  const upstream = await fetch(`${RUNDOWN_BASE}${rundownPath}`, {
    headers: { 'X-TheRundown-Key': env.THERUNDOWN_API_KEY }
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function handleRundownEvents(request, url, env, headers){
  if(request.method !== 'GET'){
    return new Response('Method not allowed', { status: 405, headers });
  }

  // Only forward the shapes we need right now:
  //   /events/{sportId}/{yyyy-mm-dd}  ->  TheRundown's
  //   /sports/{sportId}/events/{yyyy-mm-dd}
  // Extend this allowlist deliberately rather than proxying
  // arbitrary paths — the key behind it is a paid resource.
  const match = url.pathname.match(/^\/events\/(\d+)\/(\d{4}-\d{2}-\d{2})$/);
  if(!match) return new Response('Not found', { status: 404, headers });
  const [, sportId, date] = match;
  // market_ids=1 (moneyline only) — we only ever read team/score/status
  // off this response, never odds, so this trims the market/price rows
  // TheRundown would otherwise bundle in by default. TheRundown's free
  // tier meters by "data points" (not request count) and a full
  // multi-sportsbook markets payload burns through that budget fast —
  // confirmed 2026-09-10 when 36 unfiltered requests exhausted the
  // 20,000/day cap. Effectiveness of this filter is unverified until
  // the next UTC day's quota resets.
  return proxyToRundown(`/sports/${sportId}/events/${date}?market_ids=1`, env, headers);
}

async function handleRundownTeams(request, url, env, headers){
  if(request.method !== 'GET'){
    return new Response('Method not allowed', { status: 405, headers });
  }

  // /teams/{sportId} -> TheRundown's /sports/{sportId}/teams
  // One-off/occasional use: building & spot-checking the rundownTeamId
  // mapping in js/data.js, not called on every app load.
  const match = url.pathname.match(/^\/teams\/(\d+)$/);
  if(!match) return new Response('Not found', { status: 404, headers });
  const [, sportId] = match;
  return proxyToRundown(`/sports/${sportId}/teams`, env, headers);
}

async function handleLeagueFacts(request, env, leagueKey, headers){
  if(!KNOWN_LEAGUES.includes(leagueKey)){
    return new Response('Not found', { status: 404, headers });
  }
  const kvKey = `facts:${leagueKey}`;

  if(request.method === 'GET'){
    const stored = await env.LEAGUE_FACTS.get(kvKey, 'json');
    return json(stored || {}, 200, headers);
  }

  if(request.method === 'PUT'){
    let body;
    try {
      body = await request.json();
    } catch (e){
      return new Response('Invalid JSON body', { status: 400, headers });
    }
    // Expected shape: { [ruleLabel]: [teamKey, ...] }. The client (which
    // knows each rule's exclusive/rankAuto behavior) computes the full
    // object and PUTs it wholesale — this just stores whatever it's given,
    // so keep the validation limited to "is this the shape we expect".
    if(!body || typeof body !== 'object' || Array.isArray(body)){
      return new Response('Expected a JSON object', { status: 400, headers });
    }
    await env.LEAGUE_FACTS.put(kvKey, JSON.stringify(body));
    return json(body, 200, headers);
  }

  return new Response('Method not allowed', { status: 405, headers });
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if(request.method === 'OPTIONS'){
      return new Response(null, { headers });
    }

    const factsMatch = url.pathname.match(/^\/facts\/([a-z]+)$/);
    if(factsMatch) return handleLeagueFacts(request, env, factsMatch[1], headers);

    if(url.pathname.startsWith('/teams/')) return handleRundownTeams(request, url, env, headers);

    return handleRundownEvents(request, url, env, headers);
  }
};
