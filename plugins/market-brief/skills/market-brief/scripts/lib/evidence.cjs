"use strict";
const path = require("node:path");
const {errorMessage, mapLimit, writeText} = require("./util.cjs");
const {extractPage} = require("./html-extract.cjs");

const DOCS_HINT = /docs?\.|\/docs|gitbook|whitepaper|litepaper|github\.com/i;
const X_HOST = /^https?:\/\/(www\.)?(x|twitter)\.com\//i;

function kindOf(url) {
  if (X_HOST.test(url)) return "x";
  if (/github\.com/i.test(url)) return "github";
  if (DOCS_HINT.test(url)) return "docs";
  return "website";
}

// Up to researchReadsPerProject non-social links (main site first, then docs/GitHub) plus one listed X account.
function pickLinks(row, budgetCfg) {
  const websites = (row.info.websites || []).map(w => w.url).filter(Boolean);
  const socials = row.info.socials || [];
  const github = socials.filter(s => /github\.com/i.test(s.url || "")).map(s => s.url);
  const x = socials.find(s => s.type === "twitter" || X_HOST.test(s.url || ""));
  const candidates = [];
  const push = url => { if (url && !candidates.includes(url) && !X_HOST.test(url)) candidates.push(url); };
  const main = websites.find(u => !DOCS_HINT.test(u)) || websites[0];
  push(main);
  for (const u of [...websites, ...github]) if (DOCS_HINT.test(u)) push(u);
  for (const u of websites) push(u);
  const xUrl = x ? x.url : websites.find(u => X_HOST.test(u)) || null;
  return {pages: candidates.slice(0, budgetCfg.researchReadsPerProject), skipped: candidates.slice(budgetCfg.researchReadsPerProject), x: xUrl};
}

async function readLimited(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    return {text: text.slice(0, maxBytes), bytes: Buffer.byteLength(text), truncated: text.length > maxBytes};
  }
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    chunks.push(value);
    if (bytes >= maxBytes) { truncated = true; await reader.cancel().catch(() => {}); break; }
  }
  return {text: new TextDecoder("utf-8").decode(Buffer.concat(chunks.map(c => Buffer.from(c)))), bytes, truncated};
}

function addressOnPage(html, row) {
  if (!row.address) return false;
  return row.chain === "solana" ? html.includes(row.address) : html.toLowerCase().includes(row.address.toLowerCase());
}

async function readPage({id, url, kind, row, config, fetchImpl, clock, workTextDir}) {
  const cfg = config.research;
  const record = {id, tokenId: row.id, kind, url, method: "http", listedInProfile: true, observedAt: clock().toISOString()};
  try {
    const res = await fetchImpl(url, {headers: {"user-agent": cfg.userAgent, accept: "text/html,application/xhtml+xml"}, redirect: "follow", signal: AbortSignal.timeout(cfg.timeoutMs)});
    record.status = res.status;
    record.finalUrl = res.url || url;
    record.contentType = res.headers && res.headers.get ? res.headers.get("content-type") : null;
    const body = await readLimited(res, cfg.maxBytes);
    record.bytes = body.bytes;
    record.truncated = body.truncated;
    if (!res.ok) {
      record.ok = false;
      record.failureReason = `HTTP ${res.status}`;
      return {record, text: ""};
    }
    const page = extractPage(body.text);
    Object.assign(record, {
      title: page.title, metaDescription: page.metaDescription, ogTitle: page.ogTitle, ogDescription: page.ogDescription,
      twitterDescription: page.twitterDescription, jsonLd: page.jsonLd, hasNextData: page.hasNextData,
      textChars: page.text.length, excerpt: page.text.slice(0, cfg.savedExcerptChars), addressOnPage: addressOnPage(body.text, row),
    });
    const hasMeta = !!(page.metaDescription || page.ogDescription || page.twitterDescription || page.jsonLd.length);
    record.readable = page.text.length >= 200 || hasMeta;
    record.ok = true;
    if (!record.readable) record.failureReason = "no readable text or description in the HTML (likely a JavaScript-only page)";
    const full = [
      page.title && `Title: ${page.title}`,
      page.metaDescription && `Meta description: ${page.metaDescription}`,
      page.ogDescription && `og:description: ${page.ogDescription}`,
      page.twitterDescription && `twitter:description: ${page.twitterDescription}`,
      ...page.jsonLd.map(d => `JSON-LD: ${d}`),
      `Text: ${page.text.slice(0, cfg.workTextChars)}`,
    ].filter(Boolean).join("\n");
    writeText(path.join(workTextDir, `${id}.txt`), full);
    return {record, text: full};
  } catch (error) {
    record.ok = false;
    record.failureReason = errorMessage(error);
    return {record, text: ""};
  }
}

async function solanaMintFacts({mints, config, fetchImpl, clock, budget}) {
  if (!mints.length) return {record: null, facts: new Map()};
  const record = {id: "sol-RPC", kind: "rpc", method: "solana-rpc getMultipleAccounts", url: config.research.solanaRpcUrl, observedAt: clock().toISOString(), accounts: mints.length};
  const facts = new Map();
  if (!budget.take("solanaRpcCallsPerRun")) { record.ok = false; record.failureReason = "request budget exhausted (solanaRpcCallsPerRun)"; return {record, facts}; }
  try {
    const res = await fetchImpl(config.research.solanaRpcUrl, {
      method: "POST", headers: {"content-type": "application/json"},
      body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [mints.slice(0, 100), {encoding: "jsonParsed"}]}),
      signal: AbortSignal.timeout(config.research.timeoutMs),
    });
    record.status = res.status;
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error ? data.error.message : `HTTP ${res.status}`);
    record.ok = true;
    record.slot = data.result && data.result.context ? data.result.context.slot : null;
    (data.result.value || []).forEach((account, i) => {
      const parsed = account && account.data && account.data.parsed;
      if (!parsed || parsed.type !== "mint") { facts.set(mints[i], {mint: null, note: "account is not a parsed SPL mint"}); return; }
      const info = parsed.info;
      facts.set(mints[i], {mint: {program: account.data.program, mintAuthority: info.mintAuthority || null, freezeAuthority: info.freezeAuthority || null, decimals: info.decimals, supply: info.supply, isInitialized: info.isInitialized}});
    });
  } catch (error) {
    record.ok = false;
    record.failureReason = errorMessage(error);
  }
  return {record, facts};
}

async function robinhoodRegistry({rows, config, fetchImpl, clock, budget}) {
  const record = {id: "rh-REG", kind: "registry", method: "http", url: config.research.robinhoodAssetsUrl, observedAt: clock().toISOString()};
  const facts = new Map();
  if (!budget.take("robinhoodRegistryReadsPerRun")) { record.ok = false; record.failureReason = "request budget exhausted (robinhoodRegistryReadsPerRun)"; return {record, facts}; }
  try {
    const res = await fetchImpl(config.research.robinhoodAssetsUrl, {headers: {accept: "application/json"}, signal: AbortSignal.timeout(config.research.timeoutMs)});
    record.status = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const index = new Map();
    for (const asset of data.assets || []) for (const d of asset.deployments || []) {
      if (d.chainId === 4663 && d.contractAddress) index.set(d.contractAddress.toLowerCase(), {symbol: asset.tokenSymbol, name: asset.tokenName, status: asset.status, contract: d.contractAddress});
    }
    record.ok = true;
    record.assets = index.size;
    for (const row of rows) {
      const self = index.get(String(row.address).toLowerCase()) || null;
      const quotes = [];
      for (const p of row.pools) {
        const q = p.quote.address && index.get(p.quote.address.toLowerCase());
        if (q && !quotes.some(x => x.contract === q.contract)) quotes.push(q);
      }
      facts.set(row.id, {self, quotes});
    }
  } catch (error) {
    record.ok = false;
    record.failureReason = errorMessage(error);
  }
  return {record, facts};
}

// Collects primary evidence for every displayed row within the per-project and per-run budgets.
async function collectEvidence({scope, config, observations, budget, fetchImpl = fetch, clock = () => new Date(), workTextDir}) {
  const rows = observations.rows.filter(r => !r.hidden);
  let counter = 0;
  const nextId = () => `${scope}-E${++counter}`;
  const tasks = [];
  const plan = new Map();
  for (const row of rows) {
    const links = pickLinks(row, config.budget);
    plan.set(row.id, links);
    for (const url of links.pages) tasks.push({row, url, kind: kindOf(url), budgetKey: `researchReads:${row.id}`, limit: config.budget.researchReadsPerProject});
    if (links.x) tasks.push({row, url: links.x, kind: "x", budgetKey: `xReads:${row.id}`, limit: config.budget.xReadsPerProject});
  }
  for (const t of tasks) t.id = nextId();
  const results = await mapLimit(tasks, config.research.concurrency, async t => {
    if (!budget.take(t.budgetKey, t.limit)) return {record: {id: t.id, tokenId: t.row.id, kind: t.kind, url: t.url, ok: false, failureReason: "request budget exhausted"}, text: ""};
    return readPage({id: t.id, url: t.url, kind: t.kind, row: t.row, config, fetchImpl, clock, workTextDir});
  });
  const chain = {};
  let chainRecord = null;
  if (observations.chain === "solana") {
    const {record, facts} = await solanaMintFacts({mints: rows.map(r => r.address), config, fetchImpl, clock, budget});
    chainRecord = record;
    for (const row of rows) chain[row.id] = facts.get(row.address) || null;
  } else if (observations.chain === "robinhood") {
    const {record, facts} = await robinhoodRegistry({rows, config, fetchImpl, clock, budget});
    chainRecord = record;
    for (const row of rows) chain[row.id] = facts.has(row.id) ? {registry: facts.get(row.id)} : null;
  }
  const byToken = {};
  for (const row of rows) {
    const links = plan.get(row.id);
    byToken[row.id] = {
      name: row.name,
      symbol: row.symbol,
      links: {pages: links.pages, x: links.x, skippedOverBudget: links.skipped},
      evidenceIds: results.filter(r => r.record.tokenId === row.id).map(r => r.record.id),
      noWebsiteListed: !(row.info.websites || []).length,
    };
  }
  const records = results.map(r => r.record);
  return {
    texts: new Map(results.map(r => [r.record.id, r.text])),
    evidence: {
      schemaVersion: config.schemaVersion,
      scope,
      runId: observations.runId,
      collectedAt: clock().toISOString(),
      excerptPolicy: `Saved excerpts are limited to ${config.research.savedExcerptChars} characters; fuller text stays in the local work/ folder and is not published.`,
      reads: records,
      chainRecord,
      chainFacts: chain,
      byToken,
      counts: {
        reads: records.length,
        ok: records.filter(r => r.ok).length,
        readable: records.filter(r => r.ok && r.readable).length,
        failed: records.filter(r => !r.ok).length,
        rowsWithoutWebsite: rows.filter(r => !(r.info.websites || []).length).length,
      },
    },
  };
}

module.exports = {collectEvidence, pickLinks, kindOf, readPage};
