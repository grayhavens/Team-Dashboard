/* ============================================================
   THERUNDOWN PROXY (Cloudflare Worker)

   TheRundown's API key is personal to your account and must never
   ship in client-side JS (unlike TheSportsDB's public "123" test
   key) — see https://docs.therundown.io/authentication. This
   worker holds that key server-side as a secret and forwards a
   small allowlist of read-only requests to TheRundown on the
   dashboard's behalf, so js/app.js can call this worker's URL
   directly from the browser instead of TheRundown's API.

   Deploy (from this worker/ directory):
     npx wrangler login
     npx wrangler secret put THERUNDOWN_API_KEY
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

function corsHeaders(origin){
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

export default {
  async fetch(request, env){
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if(request.method === 'OPTIONS'){
      return new Response(null, { headers });
    }
    if(request.method !== 'GET'){
      return new Response('Method not allowed', { status: 405, headers });
    }

    // Only forward the one shape we need right now:
    //   /events/{sportId}/{yyyy-mm-dd}  ->  TheRundown's
    //   /sports/{sportId}/events/{yyyy-mm-dd}
    // Extend this allowlist deliberately rather than proxying
    // arbitrary paths — the key behind it is a paid resource.
    const match = url.pathname.match(/^\/events\/(\d+)\/(\d{4}-\d{2}-\d{2})$/);
    if(!match){
      return new Response('Not found', { status: 404, headers });
    }
    const [, sportId, date] = match;

    const upstream = await fetch(`${RUNDOWN_BASE}/sports/${sportId}/events/${date}`, {
      headers: { 'X-TheRundown-Key': env.THERUNDOWN_API_KEY }
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...headers, 'Content-Type': 'application/json' }
    });
  }
};
