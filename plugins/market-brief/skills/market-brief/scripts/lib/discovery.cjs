"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {REFERENCES} = require("./config.cjs");

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function extractionScript() {
  return fs.readFileSync(path.join(REFERENCES, "discovery-extract.js"), "utf8");
}

function sameUrl(a, b) {
  try {
    const x = new URL(a), y = new URL(b);
    const params = u => [...u.searchParams.entries()].sort((p, q) => p[0].localeCompare(q[0])).map(([k, v]) => `${k}=${v}`).join("&");
    return x.origin === y.origin && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "") && params(x) === params(y);
  } catch {
    return false;
  }
}

// Validates one or more page extractions from the browser and returns the discovery record.
function buildDiscovery({scope, scopeCfg, config, pages, method, savedAt}) {
  const list = Array.isArray(pages) ? pages : [pages];
  const pattern = new RegExp(scopeCfg.pairSlugPattern);
  const problems = [];
  const pools = [];
  const seen = new Set();
  const invalid = [];
  let challenge = false;
  for (const [pageIndex, page] of list.entries()) {
    if (!page || typeof page !== "object") { problems.push(`page ${pageIndex + 1}: not an object`); continue; }
    if (page.challenge) challenge = true;
    const slugs = Array.isArray(page.slugs) ? page.slugs : [];
    if (page.checksum && fnv1a(slugs.join("\n")) !== page.checksum) problems.push(`page ${pageIndex + 1}: checksum mismatch (pool list was altered after extraction)`);
    if (!page.checksum) problems.push(`page ${pageIndex + 1}: missing checksum`);
    if (pageIndex === 0 && !sameUrl(page.url, scopeCfg.discoveryUrl)) problems.push(`page 1 URL differs from the configured discovery URL: ${page.url}`);
    if (pageIndex === 0 && page.rankBy && page.rankBy !== config.filters.rankBy) problems.push(`page ranks by ${page.rankBy}, expected ${config.filters.rankBy}`);
    if (Number.isFinite(page.rowCount) && page.rowCount !== slugs.length) problems.push(`page ${pageIndex + 1}: rowCount ${page.rowCount} != ${slugs.length} slugs`);
    for (const slug of slugs) {
      if (!pattern.test(slug)) { invalid.push(slug); continue; }
      const key = slug.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pools.push({rank: pools.length + 1, slug, page: pageIndex + 1});
    }
  }
  const first = list[0] || {};
  const observedAt = first.observedAt && !Number.isNaN(Date.parse(first.observedAt)) ? new Date(first.observedAt).toISOString() : null;
  if (!observedAt) problems.push("missing or invalid observedAt");
  let status = "ok";
  let reason = null;
  if (challenge) { status = "blocked"; reason = "Cloudflare or bot challenge shown instead of the discovery table"; }
  else if (problems.length) { status = "invalid"; reason = problems.join("; "); }
  else if (!pools.length) { status = "empty"; reason = "discovery table rendered no pair rows"; }
  const lastPage = list[list.length - 1] || {};
  const possibleTruncation = (lastPage.slugs || []).length >= config.budget.fullPageRows && !!lastPage.nextPage;
  return {
    schemaVersion: config.schemaVersion,
    scope,
    chain: scopeCfg.chain,
    status,
    reason,
    method,
    discoveryUrl: scopeCfg.discoveryUrl,
    pageUrl: first.url || null,
    pageTitle: first.title || null,
    extractor: first.extractor || null,
    filtersIndicator: first.filtersIndicator || null,
    rankBy: first.rankBy || null,
    observedAt,
    savedAt,
    pageLoads: list.length,
    rowCount: pools.length,
    possibleTruncation,
    pools,
    invalidSlugs: invalid,
    problems,
  };
}

module.exports = {fnv1a, extractionScript, buildDiscovery, sameUrl};
