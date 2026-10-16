"use strict";

const ENTITIES = {amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", "#39": "'", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“"};

function decode(text) {
  return String(text || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  });
}

function clean(text) {
  return decode(text).replace(/\s+/g, " ").trim();
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : null;
}

function metaTags(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, "property") || attr(tag, "name") || "").toLowerCase();
    const content = attr(tag, "content");
    if (key && content && out[key] === undefined) out[key] = clean(content);
  }
  return out;
}

function jsonLdDescriptions(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = node => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        for (const k of ["description", "slogan", "abstract"]) if (typeof node[k] === "string") out.push(clean(node[k]));
        for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
      };
      walk(JSON.parse(m[1]));
    } catch { /* ignore invalid JSON-LD */ }
  }
  return [...new Set(out)].slice(0, 5);
}

function visibleText(html) {
  return clean(html
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, " \n ")
    .replace(/<\/(p|div|li|h[1-6]|section|article|tr)>/gi, " \n ")
    .replace(/<[^>]+>/g, " "));
}

// Extracts what a plain HTTP read can see, including meta and JSON-LD on JavaScript-rendered sites.
function extractPage(html) {
  const title = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [null, null])[1];
  const meta = metaTags(html);
  return {
    title: title ? clean(title) : null,
    metaDescription: meta.description || null,
    ogTitle: meta["og:title"] || null,
    ogDescription: meta["og:description"] || null,
    twitterDescription: meta["twitter:description"] || null,
    jsonLd: jsonLdDescriptions(html),
    hasNextData: /__NEXT_DATA__|self\.__next_f/.test(html),
    text: visibleText(html),
  };
}

module.exports = {extractPage, decode, clean};
