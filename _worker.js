// Cloudflare Worker — serves the static site, injects per-article OG tags,
// and exposes a private /api/stats endpoint that pulls Cloudflare Web Analytics
// for the admin panel.
//
// Put this file named "_worker.js" at the repo root (next to wrangler.jsonc),
// with the site at public/index.html.
//
// ENVIRONMENT VARIABLES (Worker -> Settings -> Variables and Secrets):
//   SUPABASE_URL   = https://lvrkldiszeujgcetlozh.supabase.co
//   SUPABASE_KEY   = your Supabase anon public key
//   STATS_KEY      = any secret password you choose (typed in the admin to view stats)
//   CF_API_TOKEN   = a Cloudflare API token with "Account Analytics -> Read"
//   CF_ACCOUNT_ID  = your Cloudflare account id
//   CF_SITE_TAG    = your Web Analytics site tag (defaults to the beacon token below)

const DEFAULT_SITE_TAG = "0ddb2dfd38774d74986e39101e4d0d34";

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function setMeta(html, attr, name, val) {
  const re = new RegExp(`(<meta[^>]*${attr}=["']${name}["'][^>]*content=["'])[^"']*(["'])`, "i");
  if (re.test(html)) return html.replace(re, `$1${esc(val)}$2`);
  return html.replace("</head>", `<meta ${attr}="${name}" content="${esc(val)}">\n</head>`);
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

// ---- Cloudflare Web Analytics (private, admin only) ----
async function handleStats(url, env) {
  const key = url.searchParams.get("key") || "";
  if (!env.STATS_KEY) return json({ error: "Stats not configured." }, 503);
  if (key !== env.STATS_KEY) return json({ error: "Unauthorized." }, 401);

  const token = env.CF_API_TOKEN, account = env.CF_ACCOUNT_ID;
  const siteTag = env.CF_SITE_TAG || DEFAULT_SITE_TAG;
  if (!token || !account) return json({ error: "Stats not configured." }, 503);

  let days = parseInt(url.searchParams.get("days") || "30", 10);
  if (!days || days < 1) days = 30;
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

  const query = `
    query($a:String!,$s:String!,$since:Date!){
      viewer{ accounts(filter:{accountTag:$a}){
        totals: rumPageloadEventsAdaptiveGroups(limit:1, filter:{siteTag:$s, date_geq:$since}){ count sum{ visits } }
        countries: rumPageloadEventsAdaptiveGroups(limit:8, filter:{siteTag:$s, date_geq:$since}, orderBy:[count_DESC]){ count dimensions{ countryName } }
        referrers: rumPageloadEventsAdaptiveGroups(limit:8, filter:{siteTag:$s, date_geq:$since}, orderBy:[count_DESC]){ count dimensions{ refererHost } }
        paths: rumPageloadEventsAdaptiveGroups(limit:8, filter:{siteTag:$s, date_geq:$since}, orderBy:[count_DESC]){ count dimensions{ requestPath } }
      }}
    }`;

  try {
    const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { a: account, s: siteTag, since } })
    });
    const j = await r.json();
    if (j.errors && j.errors.length) return json({ error: j.errors[0].message || "GraphQL error." }, 502);
    const acc = j.data && j.data.viewer && j.data.viewer.accounts && j.data.viewer.accounts[0];
    if (!acc) return json({ error: "No data for this account." }, 502);

    const totals = (acc.totals && acc.totals[0]) || { count: 0, sum: { visits: 0 } };
    const map = (arr, dim, fallback) =>
      (arr || []).map(x => ({ label: (x.dimensions && x.dimensions[dim]) || fallback, count: x.count }));

    return json({
      days,
      pageviews: totals.count || 0,
      visits: (totals.sum && totals.sum.visits) || 0,
      countries: map(acc.countries, "countryName", "Unknown"),
      referrers: map(acc.referrers, "refererHost", "(direct / none)"),
      paths: map(acc.paths, "requestPath", "/")
    });
  } catch (e) {
    return json({ error: "Could not reach the Cloudflare API." }, 502);
  }
}

// ---- per-article Open Graph injection ----
async function withOG(res, url, env, id) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;
  let html = await res.text();

  const SB = (env.SUPABASE_URL || "https://YOUR-PROJECT.supabase.co").replace(/\/+$/, "");
  const KEY = env.SUPABASE_KEY || "YOUR_ANON_KEY";

  let title = "t.ilias · Geopolitics & Security Analysis";
  let desc  = "Publications, interactive maps and stats on geopolitics, security and the post-Soviet space, by Timoleon Ilias.";
  let image = "";
  try {
    const r = await fetch(`${SB}/rest/v1/publications?id=eq.${encodeURIComponent(id)}&select=data`,
      { headers: { apikey: KEY, Authorization: "Bearer " + KEY } });
    if (r.ok) {
      const rows = await r.json();
      const p = rows[0] && rows[0].data;
      if (p) { title = p.title ? p.title + " · t.ilias" : title; desc = p.excerpt || p.title || desc; image = p.photo || ""; }
    }
  } catch (e) {}

  const pageUrl = url.origin + url.pathname + "?p=" + encodeURIComponent(id) + "#/article/" + id;
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${esc(title)}</title>`);
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", desc);
  html = setMeta(html, "property", "og:image", image);
  html = setMeta(html, "property", "og:url", pageUrl);
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", desc);
  html = setMeta(html, "name", "twitter:image", image);
  html = setMeta(html, "name", "twitter:card", image ? "summary_large_image" : "summary");

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=300");
  return new Response(html, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats") return handleStats(url, env);

    const res = await env.ASSETS.fetch(request);

    const id = url.searchParams.get("p");
    if (id) return withOG(res, url, env, id);
    return res;
  }
};
