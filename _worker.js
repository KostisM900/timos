// Cloudflare Pages — per-article social preview (Open Graph / Twitter Card)
// Location: put this file named "_worker.js" NEXT TO index.html, then drag the
// whole folder into Cloudflare Pages (Direct Upload). Unlike a functions/ folder,
// a _worker.js IS supported by dashboard drag-and-drop.
//
// SETUP: in your Pages project → Settings → Variables and Secrets, add:
//   SUPABASE_URL = https://YOUR-PROJECT.supabase.co
//   SUPABASE_KEY = your anon public key
// (or hardcode them in the two FALLBACK lines below)

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function setMeta(html, attr, name, val) {
  const re = new RegExp(`(<meta[^>]*${attr}=["']${name}["'][^>]*content=["'])[^"']*(["'])`, "i");
  if (re.test(html)) return html.replace(re, `$1${esc(val)}$2`);
  return html.replace("</head>", `<meta ${attr}="${name}" content="${esc(val)}">\n</head>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get("p");

    // Always let Cloudflare serve the static file first.
    const res = await env.ASSETS.fetch(request);

    // Only rewrite when a specific article is requested and we got HTML back.
    if (!id) return res;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return res;

    let html = await res.text();

    const SB = (env.SUPABASE_URL || "https://YOUR-PROJECT.supabase.co").replace(/\/+$/, ""); // FALLBACK
    const KEY = env.SUPABASE_KEY || "YOUR_ANON_KEY"; // FALLBACK

    let title = "t.ilias · Geopolitics & Security Analysis";
    let desc  = "Publications, interactive maps and stats on geopolitics, security and the post-Soviet space, by Timoleon Ilias.";
    let image = "";

    try {
      const r = await fetch(
        `${SB}/rest/v1/publications?id=eq.${encodeURIComponent(id)}&select=data`,
        { headers: { apikey: KEY, Authorization: "Bearer " + KEY } }
      );
      if (r.ok) {
        const rows = await r.json();
        const p = rows[0] && rows[0].data;
        if (p) {
          title = p.title ? p.title + " · t.ilias" : title;
          desc  = p.excerpt || p.title || desc;
          image = p.photo || "";
        }
      }
    } catch (e) { /* fall back to defaults */ }

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
};
