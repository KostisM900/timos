// build.mjs — pre-renders each publication into a real, crawlable URL.
// Run: node build.mjs   (Node 18+, no dependencies)
// Output: ./dist  (this is what GitHub Pages deploys)
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync, readdirSync } from "node:fs";

const SITE = "https://www.tilias.eu";          // canonical origin (no trailing slash)
const OG_DEFAULT = SITE + "/og.png";
const ROOT = ".";
const OUT = "dist";

// ---- read the SPA shell ----
const index = readFileSync(`${ROOT}/index.html`, "utf8");

// reuse the exact CSS of the site (all <style> blocks)
const css = (index.match(/<style[\s\S]*?<\/style>/gi) || []).join("\n");

// fonts <link> (so static pages match)
const fontLinks = (index.match(/<link[^>]+fonts[^>]*>/gi) || []).join("\n");

// favicon (inline svg) reused from the shell
const faviconM = index.match(/<link rel="icon"[^>]*>/i);
const favicon = faviconM ? faviconM[0] : "";

// ---- Supabase creds parsed from the shell (single source of truth) ----
const SUPABASE_URL = (index.match(/const SUPABASE_URL="([^"]+)"/) || [])[1] || "";
const SUPABASE_KEY = (index.match(/const SUPABASE_KEY="([^"]+)"/) || [])[1] || "";
const SB_BASE = SUPABASE_URL.replace(/\/+$/, "").replace(/\/rest\/v1$/, "");

// ---- helpers replicated from the site ----
const esc = s => (s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = d => { if (!d) return ""; const dt = new Date(d); return isNaN(dt) ? d : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); };
const bodyHtml = t => (t || "").split(/\n{2,}/).map(b => { b = b.trim(); if (!b) return ""; return b.startsWith("## ") ? "<h3>" + esc(b.slice(3)) + "</h3>" : "<p>" + esc(b).replace(/\n/g, "<br>") + "</p>"; }).join("");
const renderBody = b => { b = b || ""; let html = /<[a-z][\s\S]*>/i.test(b) ? b : bodyHtml(b); return html.replace(/<table class="a-table">/g, '<div class="table-wrap"><table class="a-table">').replace(/<\/table>/g, "</table></div>"); };
const readingTime = p => { if (!p || p.type !== "internal" || !p.body) return ""; const text = String(p.body).replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim(); const w = text ? text.split(" ").length : 0; if (w < 20) return ""; return Math.max(1, Math.round(w / 200)) + " min read"; };
const FLAG_EN = `<svg class="flag" viewBox="0 0 60 40"><clipPath id="ukc"><rect width="60" height="40" rx="2"/></clipPath><g clip-path="url(#ukc)"><rect width="60" height="40" fill="#012169"/><path d="M0 0 60 40M60 0 0 40" stroke="#fff" stroke-width="8"/><path d="M0 0 60 40M60 0 0 40" stroke="#C8102E" stroke-width="4"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="13"/><path d="M30 0v40M0 20h60" stroke="#C8102E" stroke-width="7"/></g></svg>`;
const FLAG_EL = `<svg class="flag" viewBox="0 0 60 40"><clipPath id="grc"><rect width="60" height="40" rx="2"/></clipPath><g clip-path="url(#grc)"><rect width="60" height="40" fill="#0D5EAF"/><g fill="#fff"><rect y="4.4" width="60" height="4.4"/><rect y="13.3" width="60" height="4.4"/><rect y="22.2" width="60" height="4.4"/><rect y="31.1" width="60" height="4.4"/></g><rect width="22.2" height="22.2" fill="#0D5EAF"/><rect x="8.9" width="4.4" height="22.2" fill="#fff"/><rect y="8.9" width="22.2" height="4.4" fill="#fff"/></g></svg>`;
const flagFor = l => l === "el" ? FLAG_EL : FLAG_EN;
const pdfEmbedUrl = url => { if (!url) return ""; const g = url.match(/drive\.google\.com\/file\/d\/([^/?#]+)/) || (/drive\.google\.com/.test(url) ? url.match(/[?&]id=([^&]+)/) : null); if (g) return `https://drive.google.com/file/d/${g[1]}/preview`; if (/[?&]dl=0/.test(url)) return url.replace(/([?&])dl=0/, "$1raw=1"); return url + (url.includes("#") ? "" : "#view=FitH"); };

const LI_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.36V9h3.41v1.56h.05c.47-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>`;

const HEADER = `<header class="mast"><div class="wrap">
  <a class="brand" href="/">t<span class="dot">.</span><span class="lo">ilias</span></a>
  <button class="menu-btn" id="menuBtn" aria-label="Menu">\u2630</button>
  <nav class="main" id="nav">
    <a href="/">Home</a>
    <a href="/#/publications">Publications</a>
    <a href="/#/maps">Maps &amp; Stats</a>
    <a href="/#/countries">Countries</a>
    <a href="/#/about">About</a>
    <a class="li-icon" href="https://www.linkedin.com/in/timoleon-ilias-278769283/" target="_blank" rel="noopener" aria-label="LinkedIn">${LI_SVG}</a>
  </nav>
</div></header>`;

const FOOTER = `<footer class="foot"><div class="wrap">
  <a class="brand" href="/" style="color:#fff;font-family:var(--display);font-weight:700">t.ilias</a>
  <div class="links">
    <a href="/#/publications">Publications</a><a href="/#/maps">Maps &amp; Stats</a>
    <a href="/#/countries">Countries</a><a href="/#/about">About</a>
    <a href="https://www.linkedin.com/in/timoleon-ilias-278769283/" target="_blank" rel="noopener">LinkedIn</a>
  </div>
  <small>\u00a9 2026 Timoleon Ilias \u00b7 Geopolitics &amp; security analysis.</small>
</div></footer>`;

const imageFor = p => (p.photo && /^https?:\/\//.test(p.photo)) ? p.photo : OG_DEFAULT;

function staticCard(p) {
  const cover = p.photo
    ? `<div class="cover-bg" style="background-image:url('${esc(p.photo)}')"></div><img src="${esc(p.photo)}" alt="" loading="lazy">`
    : `<div class="cover-fallback"></div>`;
  const tags = (p.tags || []).slice(0, 3).map(x => `<span>${esc(x)}</span>`).join("");
  return `<a class="card" href="/p/${p.id}/">
    <div class="cover">${cover}<span class="tag">${esc(p.category || (p.tags && p.tags[0]) || "Analysis")}</span></div>
    <div class="cbody">
      <div class="meta">${flagFor(p.lang)}<span>${esc(p.author || "t.ilias")}</span><span>\u00b7</span><span>${fmt(p.date)}</span></div>
      <h3 class="t">${esc(p.title)}</h3>
      <p class="ex">${esc(p.excerpt || "")}</p>
      <div class="tags">${tags}</div>
    </div></a>`;
}

function articleHtml(p, all) {
  const canonical = `${SITE}/p/${p.id}/`;
  const desc = (p.excerpt || p.title || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const img = imageFor(p);
  const lang = p.lang === "el" ? "el" : "en";
  const isPdf = p.type === "pdf" && p.pdfUrl;
  const main = isPdf
    ? `<div class="pdf-wrap"><iframe class="pdf-frame" src="${esc(pdfEmbedUrl(p.pdfUrl))}" title="${esc(p.title)}" allow="autoplay" loading="lazy"></iframe></div>
       <div class="pdf-actions"><a class="btn line" href="${esc(p.pdfUrl)}" target="_blank" rel="noopener">Open original \u2197</a></div>`
    : `<div class="content">${renderBody(p.body) || "<p>(No content yet.)</p>"}</div>`;
  const hero = (!isPdf && p.photo)
    ? `<div class="art-hero"><div class="cover-bg" style="background-image:url('${esc(p.photo)}')"></div><img src="${esc(p.photo)}" alt=""></div>` : "";
  const refs = (p.references && p.references.length)
    ? `<div class="refbox"><h4>References</h4><ol>${p.references.map(r => `<li>${esc(r)}</li>`).join("")}</ol></div>` : "";

  const u = encodeURIComponent(canonical), t = encodeURIComponent(p.title || "");
  const share = `<div class="share"><span>Share:</span>
    <a class="sbtn fb" href="https://www.facebook.com/sharer/sharer.php?u=${u}" target="_blank" rel="noopener" aria-label="Share on Facebook"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 22v-8h2.7l.4-3H13V9c0-.9.2-1.5 1.5-1.5H16V4.9c-.3 0-1.2-.1-2.2-.1-2.2 0-3.8 1.3-3.8 3.8V11H7.5v3H10v8h3z"/></svg></a>
    <a class="sbtn x" href="https://twitter.com/intent/tweet?url=${u}&text=${t}" target="_blank" rel="noopener" aria-label="Share on X"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2H22l-7.4 8.4L23 22h-6.9l-5.4-7-6.2 7H1.5l7.9-9L1 2h7l4.9 6.5L18.9 2zm-2.4 18h1.9L7.6 4H5.6l10.9 16z"/></svg></a>
    <a class="sbtn li" href="https://www.linkedin.com/sharing/share-offsite/?url=${u}" target="_blank" rel="noopener" aria-label="Share on LinkedIn">${LI_SVG}</a>
    ${(p.tags || []).map(tg => `<a class="chip" href="/#/tag/${encodeURIComponent(tg)}">${esc(tg)}</a>`).join("")}
  </div>`;

  const others = all.filter(x => x.id !== p.id && (x.type === "internal" || x.type === "pdf") && !x.draft)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 3);
  const moreSec = others.length ? `<section class="section"><div class="wrap">
    <div class="sec-head"><div><span class="kicker">More</span><h2>More publications</h2></div><a class="more" href="/#/publications">All \u2192</a></div>
    <div class="pub-grid">${others.map(staticCard).join("")}</div>
  </div></section>` : "";

  const ld = {
    "@context": "https://schema.org", "@type": isPdf ? "Article" : "NewsArticle",
    headline: p.title || "", description: desc,
    datePublished: p.date || "", dateModified: p.date || "",
    inLanguage: lang, image: [img],
    author: { "@type": "Person", name: p.author || "Timoleon Ilias", url: SITE + "/#/about" },
    publisher: { "@type": "Person", name: "Timoleon Ilias" },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    isPartOf: { "@type": "WebSite", name: "t.ilias", url: SITE + "/" }
  };
  if (p.tags && p.tags.length) ld.keywords = p.tags.join(", ");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)} \u00b7 t.ilias</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow">
<meta name="author" content="${esc(p.author || "Timoleon Ilias")}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="t.ilias">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${esc(img)}">
<meta property="article:published_time" content="${esc(p.date || "")}">
<meta property="article:author" content="${esc(p.author || "Timoleon Ilias")}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
${favicon}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${fontLinks}
${css}
</head>
<body>
${HEADER}
<main id="app">
  <article class="article ${isPdf ? "article-wide" : ""}">
    <a class="back" href="/#/publications">\u2190 All publications</a>
    <div class="meta">${flagFor(p.lang)}<span>${esc(p.author || "t.ilias")}</span><span>\u00b7</span><span>${fmt(p.date)}</span>${readingTime(p) ? `<span>\u00b7</span><span>${readingTime(p)}</span>` : ""}</div>
    <h1>${esc(p.title)}</h1>
    ${p.excerpt ? `<p class="lead">${esc(p.excerpt)}</p>` : ""}
    ${hero}
    ${main}
    ${refs}
    ${share}
  </article>
  ${moreSec}
</main>
${FOOTER}
<script>var mb=document.getElementById("menuBtn");if(mb)mb.onclick=function(){document.getElementById("nav").classList.toggle("open");};</script>
</body>
</html>`;
}

// ---- fetch publications from Supabase ----
async function fetchPubs() {
  if (!SB_BASE || !SUPABASE_KEY) { console.warn("No Supabase creds found in index.html"); return []; }
  try {
    const r = await fetch(`${SB_BASE}/rest/v1/publications?select=data&order=date.desc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY }
    });
    if (!r.ok) { console.error("Supabase fetch failed:", r.status); return []; }
    return (await r.json()).map(x => x.data).filter(Boolean);
  } catch (e) { console.error("Supabase fetch error:", e.message); return []; }
}

// ---- assemble dist/ ----
function copyShell() {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const skip = new Set(["dist", ".git", ".github", "node_modules", "build.mjs"]);
  for (const name of readdirSync(ROOT)) {
    if (skip.has(name)) continue;
    cpSync(`${ROOT}/${name}`, `${OUT}/${name}`, { recursive: true });
  }
}

(async () => {
  const pubs = await fetchPubs();
  const printable = pubs.filter(p => p && p.id && !p.draft && (p.type === "internal" || p.type === "pdf"));
  console.log(`Fetched ${pubs.length} publications; ${printable.length} get a static page.`);

  copyShell();

  // per-article pages
  for (const p of printable) {
    const dir = `${OUT}/p/${p.id}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/index.html`, articleHtml(p, pubs), "utf8");
  }

  // sitemap
  const urls = [`<url><loc>${SITE}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`]
    .concat(printable.map(p => `<url><loc>${SITE}/p/${p.id}/</loc>${p.date ? `<lastmod>${p.date}</lastmod>` : ""}<changefreq>monthly</changefreq><priority>0.8</priority></url>`));
  writeFileSync(`${OUT}/sitemap.xml`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`, "utf8");

  // SPA fallback (new/unbuilt /p/ paths render client-side) + keep custom domain
  writeFileSync(`${OUT}/404.html`, readFileSync(`${OUT}/index.html`, "utf8"), "utf8");
  writeFileSync(`${OUT}/CNAME`, "www.tilias.eu\n", "utf8");

  console.log("Build complete -> ./dist");
})();
