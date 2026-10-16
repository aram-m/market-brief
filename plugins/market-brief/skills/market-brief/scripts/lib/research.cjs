"use strict";

const FIELDS = new Set(["purpose", "mechanics", "provenance", "supply", "adoption", "launch", "risk"]);
const KINDS = new Set(["project_claim", "third_party", "measured"]);
const STATUSES = new Set(["claimed_unverified", "verified"]);
const LAUNCH = /^(launch date unverified|newly discovered|verified launch \d{4}-\d{2}-\d{2})$/;
const CHAIN_REFS = new Set(["sol-RPC", "rh-REG"]);

function overviewStatus(project) {
  const own = (project && project.claims || []).filter(c => c.kind === "project_claim");
  const has = field => own.some(c => c.field === field);
  if (has("purpose") && has("mechanics")) return "complete";
  if (own.length) return "partial";
  return "incomplete";
}

// Checks that researched rows are grounded in this run's evidence, measured facts or web reads.
// Research is on request, so rows without an entry are allowed unless requireAll is set.
function validateResearch({research, observations, evidence, measuredByToken, config, requireAll = false}) {
  const errors = [];
  const warnings = [];
  const err = (id, msg) => errors.push(id ? `${id}: ${msg}` : msg);
  if (!research || typeof research !== "object") return {errors: ["research file is not an object"], warnings, statusByToken: {}};
  if (research.scope !== observations.scope) err(null, `scope ${research.scope} != ${observations.scope}`);
  if (research.runId !== observations.runId) err(null, `runId ${research.runId} != ${observations.runId}`);
  const displayed = observations.rows.filter(r => !r.hidden);
  const displayedIds = new Set(displayed.map(r => r.id));
  const reads = new Map((evidence.reads || []).map(r => [r.id, r]));
  const chainOk = evidence.chainRecord && evidence.chainRecord.ok ? new Set([evidence.chainRecord.id]) : new Set();
  const webReads = new Map();
  const perToken = new Map();
  for (const w of research.webReads || []) {
    if (!/^W\d+$/.test(w.id || "")) err(null, `web read id must look like W1: ${w.id}`);
    if (!["websearch", "webfetch"].includes(w.method)) err(w.id, `method must be websearch or webfetch`);
    if (!displayedIds.has(w.tokenId)) err(w.id, `tokenId ${w.tokenId} is not a displayed row`);
    if (!w.observedAt || Number.isNaN(Date.parse(w.observedAt))) err(w.id, "observedAt missing");
    if (w.method === "webfetch" && !/^https?:\/\//.test(w.url || "")) err(w.id, "webfetch needs a url");
    if (w.method === "websearch" && !w.query) err(w.id, "websearch needs a query");
    webReads.set(w.id, w);
    const t = perToken.get(w.tokenId) || {websearch: 0, webfetch: 0};
    t[w.method] = (t[w.method] || 0) + 1;
    perToken.set(w.tokenId, t);
  }
  for (const [tokenIdKey, counts] of perToken) {
    const httpReads = (evidence.reads || []).filter(r => r.tokenId === tokenIdKey && r.kind !== "x").length;
    if (httpReads + counts.webfetch > config.budget.researchReadsPerProject) err(tokenIdKey, `${httpReads} page reads + ${counts.webfetch} WebFetch exceed researchReadsPerProject (${config.budget.researchReadsPerProject})`);
    if (counts.websearch > config.budget.webSearchesPerIncompleteRow) err(tokenIdKey, `${counts.websearch} web searches exceed webSearchesPerIncompleteRow (${config.budget.webSearchesPerIncompleteRow})`);
  }

  const resolve = (tokenIdKey, ref) => {
    if (typeof ref !== "string") return {ok: false, why: "reference is not a string"};
    if (ref.startsWith("measured:")) return (measuredByToken[tokenIdKey] || []).some(f => f.key === ref) ? {ok: true, type: "measured"} : {ok: false, why: `${ref} is not a measured fact for this row`};
    if (CHAIN_REFS.has(ref)) return chainOk.has(ref) ? {ok: true, type: "chain"} : {ok: false, why: `${ref} read failed or is absent`};
    if (reads.has(ref)) {
      const r = reads.get(ref);
      if (r.tokenId !== tokenIdKey) return {ok: false, why: `${ref} belongs to ${r.tokenId}`};
      if (!r.ok || !r.readable) return {ok: false, why: `${ref} has no readable content (${r.failureReason || "failed"})`};
      return {ok: true, type: r.kind === "x" ? "x" : "page"};
    }
    if (webReads.has(ref)) {
      const w = webReads.get(ref);
      if (w.tokenId !== tokenIdKey) return {ok: false, why: `${ref} belongs to ${w.tokenId}`};
      if (w.status !== "ok") return {ok: false, why: `${ref} failed`};
      return {ok: true, type: w.method};
    }
    return {ok: false, why: `unknown reference ${ref}`};
  };

  const statusByToken = {};
  const seen = new Set();
  for (const p of research.projects || []) {
    const id = p.id;
    if (!displayedIds.has(id)) { err(id, "not a displayed row (hidden or unknown)"); continue; }
    if (seen.has(id)) err(id, "duplicate project entry");
    seen.add(id);
    for (const [i, c] of (p.claims || []).entries()) {
      const where = `${id} claim ${i + 1}`;
      if (!FIELDS.has(c.field)) err(where, `field must be one of ${[...FIELDS].join(", ")}`);
      if (!KINDS.has(c.kind)) err(where, `kind must be one of ${[...KINDS].join(", ")}`);
      if (!STATUSES.has(c.status)) err(where, `status must be claimed_unverified or verified`);
      if (!c.text || typeof c.text !== "string") err(where, "text missing");
      else if (c.text.length > config.brief.claimMaxChars) err(where, `text longer than ${config.brief.claimMaxChars} characters`);
      const refs = Array.isArray(c.evidence) ? c.evidence : [];
      if (!refs.length) err(where, "needs at least one evidence reference");
      const types = [];
      for (const ref of refs) {
        const r = resolve(id, ref);
        if (!r.ok) err(where, r.why); else types.push(r.type);
      }
      if (c.kind === "measured" && types.some(t => t !== "measured" && t !== "chain")) err(where, "a measured claim may cite only measured facts or chain reads");
      if (c.status === "verified" && !types.some(t => t === "measured" || t === "chain")) err(where, "verified needs a measured fact or chain read; project statements stay claimed_unverified");
      if (c.kind === "project_claim" && types.length && types.every(t => t === "websearch")) warnings.push(`${where}: project claim supported only by a search result; prefer the primary page`);
    }
    const ai = p.aiView || {};
    if (!ai.text || typeof ai.text !== "string") err(id, "aiView.text missing");
    else if (ai.text.length > config.brief.aiViewMaxChars) err(id, `aiView.text longer than ${config.brief.aiViewMaxChars} characters`);
    const basedOn = Array.isArray(ai.basedOn) ? ai.basedOn : [];
    if (!basedOn.length) err(id, "aiView.basedOn needs at least one reference");
    for (const ref of basedOn) { const r = resolve(id, ref); if (!r.ok) err(`${id} aiView`, r.why); }
    if (p.launch && p.launch.label) {
      if (!LAUNCH.test(p.launch.label)) err(id, `launch.label must be "launch date unverified", "newly discovered" or "verified launch YYYY-MM-DD"`);
      if (/^verified launch/.test(p.launch.label)) {
        const refs = (p.launch.evidence || []).map(ref => ({ref, ...resolve(id, ref)})).filter(r => r.ok);
        if (!refs.length || refs.every(r => r.ref === "measured:poolAge")) err(id, "a verified launch needs dated release evidence; pool creation does not prove a launch");
        if (refs.length && refs.every(r => r.type === "x")) err(id, "a verified launch cannot rest on X posts alone");
      }
    }
    const status = overviewStatus(p);
    statusByToken[id] = status;
    if (status !== "complete" && !(p.gaps || []).length) err(id, `overview is ${status}; list the missing evidence in gaps[]`);
    for (const g of p.gaps || []) if (!g.what || !g.reason) err(id, "each gap needs what and reason");
  }
  const notResearched = displayed.filter(row => !seen.has(row.id)).map(row => row.id);
  if (requireAll) for (const id of notResearched) err(id, "displayed row has no research entry");
  return {errors, warnings, statusByToken, researched: seen.size, notResearched: notResearched.length};
}

module.exports = {validateResearch, overviewStatus};
