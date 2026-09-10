/* ============================================================
   DASHBOARD WORKER (Cloudflare Worker)

   Three unrelated jobs live here, all because they need something
   server-side that GitHub Pages (pure static hosting) can't do:

   1. THERUNDOWN PROXY — TheRundown's API key is personal to your
      account and must never ship in client-side JS (unlike
      TheSportsDB's old public "123" test key) — see
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

   3. THESPORTSDB PROXY — once on the premium tier, the API key is a
      real paid credential (unlike the free "123" key, which is
      public and meant to be embedded client-side) and must never
      ship in client-side JS either. Forwards a small allowlist of
      team/schedule/table requests to TheSportsDB on the dashboard's
      behalf: V2 (header auth, https://www.thesportsdb.com/api/v2/json)
      for team lookup and schedules, V1 (key embedded in the URL path,
      like the old free key) for the league table — V2's docs don't
      show a standings/table endpoint, and premium is documented to
      raise V1's own limits too, so V1-with-the-premium-key is the
      deliberate choice here rather than a fallback we forgot to
      finish. Unverified until tested with a real key — see the
      migration plan's Phase 1.

   EDGE CACHING — every proxied GET is cached in Workers' shared edge
   cache (caches.default), keyed on the upstream URL alone, with a TTL
   matched to how fast that data actually changes (see CACHE_TTL_SECONDS
   below). This exists because the client-side TTLs in js/app.js only
   protect a single browser: with several drafters loading the dashboard
   at once (e.g. everyone checking scores during a Saturday college
   football slate), each browser was independently re-hitting TheRundown
   on its own schedule, multiplying real upstream calls by however many
   tabs were open. That's how 36 "requests" blew a 20,000/day data-point
   budget in one sitting — this collapses concurrent/near-concurrent
   requests for the same data into one upstream fetch, shared by everyone.

   Deploy (from this worker/ directory):
     npx wrangler login
     npx wrangler secret put THERUNDOWN_API_KEY
     npx wrangler secret put SPORTSDB_API_KEY
     npx wrangler kv namespace create LEAGUE_FACTS
     (paste the printed id into wrangler.toml's kv_namespaces block)
     npx wrangler deploy
   Then set RUNDOWN_PROXY_BASE in js/app.js to the deployed
   *.workers.dev URL wrangler prints out.
   ============================================================ */

const RUNDOWN_BASE = 'https://api.therundown.io/api/v2';
const SPORTSDB_V2_BASE = 'https://www.thesportsdb.com/api/v2/json';
const SPORTSDB_V1_BASE = 'https://www.thesportsdb.com/api/v1/json';

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

/* ---- Adding a new league or upstream endpoint: keep this scalable ----
   1. If the credential behind it is private/paid (not a public test
      key like TheSportsDB's old "123"), it MUST be proxied through
      this Worker, never shipped in client JS — add a new proxyTo/
      handle function pair mirroring the ones below.
   2. Every new upstream fetch MUST go through cachedUpstreamFetch, not
      a bare fetch() — add its TTL to CACHE_TTL_SECONDS below rather
      than hardcoding a number inline. Pick that TTL to match whatever
      TTL you're also about to use client-side (see the matching
      checklist next to RUNDOWN_CACHE_TTL_MS in js/app.js) — one
      freshness decision, not two that can quietly drift apart.
   3. Add the new league's key to KNOWN_LEAGUES only if it needs the
      League Facts feature (shared cross-viewer marks) — most new
      leagues won't need this on day one.
   4. If an endpoint's real response shape is unverified (no confirmed
      docs, or docs that don't match reality — see the V1/V2 standings
      note above), curl it directly with a real key and confirm the
      shape before any client code gets built against it. */

// How long each upstream shape is trusted in the edge cache before a
// fresh fetch is made — matched to the client-side TTLs in js/app.js
// (RUNDOWN_CACHE_TTL_MS, TEAM_INFO_TTL_MS, EPL_STANDINGS_TTL_MS) so this
// layer never serves staler data than a single browser would already
// tolerate; it only stops N browsers from each re-fetching the same
// thing independently.
const CACHE_TTL_SECONDS = {
  rundownEvents: 60,           // a day's slate barely changes minute to minute
  rundownTeams: 60 * 60,       // one-off/occasional lookups, not polled on a schedule
  sportsdbTeam: 24 * 60 * 60,  // sport/founded/stadium/colors — effectively static
  sportsdbSchedule: 60,        // last-result / next-fixture, refreshed on the same cadence as rundownEvents
  sportsdbTable: 15 * 60       // league standings
};

// Shared building block for every proxy below: check the edge cache
// first (keyed on the upstream URL only — never the incoming request,
// whose Origin header varies per caller and would otherwise fragment
// the cache key for no reason), and on a miss fetch + cache the result
// for ttlSeconds before returning it. ctx.waitUntil lets the cache
// write finish after the response has already gone back to the client.
async function cachedUpstreamFetch(upstreamUrl, ttlSeconds, fetchOptions, ctx){
  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });

  const cached = await cache.match(cacheKey);
  if(cached) return cached;

  const upstream = await fetch(upstreamUrl, fetchOptions);
  if(upstream.ok){
    const toReturn = new Response(upstream.body, upstream);
    const toCache = toReturn.clone();
    toCache.headers.set('Cache-Control', `public, max-age=${ttlSeconds}`);
    ctx.waitUntil(cache.put(cacheKey, toCache));
    return toReturn;
  }
  // Never cache an error response — a transient upstream failure
  // shouldn't get pinned in the shared cache for everyone.
  return upstream;
}

async function proxyToRundown(rundownPath, env, headers, ttlSeconds, ctx){
  const upstream = await cachedUpstreamFetch(`${RUNDOWN_BASE}${rundownPath}`, ttlSeconds, {
    headers: { 'X-TheRundown-Key': env.THERUNDOWN_API_KEY }
  }, ctx);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function handleRundownEvents(request, url, env, headers, ctx){
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
  // the next UTC day's quota resets. The edge cache above (see
  // CACHE_TTL_SECONDS) also now collapses every viewer's request for
  // the same sportId+date into one upstream call instead of one per
  // browser, which is the bigger lever on that same budget.
  return proxyToRundown(`/sports/${sportId}/events/${date}?market_ids=1`, env, headers, CACHE_TTL_SECONDS.rundownEvents, ctx);
}

async function handleRundownTeams(request, url, env, headers, ctx){
  if(request.method !== 'GET'){
    return new Response('Method not allowed', { status: 405, headers });
  }

  // /teams/{sportId} -> TheRundown's /sports/{sportId}/teams
  // One-off/occasional use: building & spot-checking the rundownTeamId
  // mapping in js/data.js, not called on every app load.
  const match = url.pathname.match(/^\/teams\/(\d+)$/);
  if(!match) return new Response('Not found', { status: 404, headers });
  const [, sportId] = match;
  return proxyToRundown(`/sports/${sportId}/teams`, env, headers, CACHE_TTL_SECONDS.rundownTeams, ctx);
}

async function proxyToSportsDbV2(sportsdbPath, env, headers, ttlSeconds, ctx){
  const upstream = await cachedUpstreamFetch(`${SPORTSDB_V2_BASE}${sportsdbPath}`, ttlSeconds, {
    headers: { 'X-API-KEY': env.SPORTSDB_API_KEY }
  }, ctx);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function proxyToSportsDbV1(sportsdbPath, env, headers, ttlSeconds, ctx){
  // V1 takes the key as a URL segment (same shape as the old public
  // "123" key), not a header — this just substitutes the real premium
  // key in that same slot. The key ends up embedded in the edge cache's
  // key too, but that cache is internal to this Worker (never exposed
  // to a caller), so it's the same exposure as the outbound fetch itself.
  const upstream = await cachedUpstreamFetch(`${SPORTSDB_V1_BASE}/${env.SPORTSDB_API_KEY}${sportsdbPath}`, ttlSeconds, {}, ctx);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

async function handleSportsDb(request, url, env, headers, ctx){
  if(request.method !== 'GET'){
    return new Response('Method not allowed', { status: 405, headers });
  }

  // Deliberately narrow allowlist — extend it only as new pieces of
  // js/app.js actually need them, same discipline as the TheRundown
  // routes above. Paths chosen from TheSportsDB's V2 docs; response
  // shapes were unverified as of writing (see the migration plan) —
  // curl these directly to confirm before building any client code
  // against them.
  let match;

  if((match = url.pathname.match(/^\/sportsdb\/team\/(\d+)$/))){
    return proxyToSportsDbV2(`/lookup/team/${match[1]}`, env, headers, CACHE_TTL_SECONDS.sportsdbTeam, ctx);
  }
  if((match = url.pathname.match(/^\/sportsdb\/schedule-next\/(\d+)$/))){
    return proxyToSportsDbV2(`/schedule/next/team/${match[1]}`, env, headers, CACHE_TTL_SECONDS.sportsdbSchedule, ctx);
  }
  if((match = url.pathname.match(/^\/sportsdb\/schedule-previous\/(\d+)$/))){
    return proxyToSportsDbV2(`/schedule/previous/team/${match[1]}`, env, headers, CACHE_TTL_SECONDS.sportsdbSchedule, ctx);
  }
  // No confirmed V2 standings endpoint exists — this deliberately
  // stays on V1 with the premium key attached. See the header comment.
  if((match = url.pathname.match(/^\/sportsdb\/table\/(\d+)\/([\w-]+)$/))){
    const [, leagueId, season] = match;
    return proxyToSportsDbV1(`/lookuptable.php?l=${leagueId}&s=${season}`, env, headers, CACHE_TTL_SECONDS.sportsdbTable, ctx);
  }

  return new Response('Not found', { status: 404, headers });
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
  async fetch(request, env, ctx){
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if(request.method === 'OPTIONS'){
      return new Response(null, { headers });
    }

    const factsMatch = url.pathname.match(/^\/facts\/([a-z]+)$/);
    if(factsMatch) return handleLeagueFacts(request, env, factsMatch[1], headers);

    if(url.pathname.startsWith('/sportsdb/')) return handleSportsDb(request, url, env, headers, ctx);

    if(url.pathname.startsWith('/teams/')) return handleRundownTeams(request, url, env, headers, ctx);

    return handleRundownEvents(request, url, env, headers, ctx);
  }
};
