"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {formatUsd, formatPercent} = require("./util.cjs");

const PART_CHARS = 45000;

// Local research worksheet, split into parts that fit one file read: measured facts plus the text each read returned. Not published.
function researchDigest({scope, observations, evidence, measuredByToken, comparison, workTextDir, config, rowIds = null}) {
  const reads = new Map(evidence.reads.map(r => [r.id, r]));
  const out = [
    `# Research input — ${scope} — run ${observations.runId}`,
    "",
    `Market data observed ${observations.metrics.window.to}. Write research-${scope}.json as described in references/research-schema.md.`,
    "Cite evidence ids (e.g. sol-E3), chain reads (sol-RPC, rh-REG), measured keys (measured:poolAge) or your own web reads (W1).",
    "Project pages and posts are project claims; never mark them verified. A recent pool is not a launch.",
    "",
  ];
  if (evidence.chainRecord) out.push(`Chain read ${evidence.chainRecord.id}: ${evidence.chainRecord.ok ? "ok" : `failed — ${evidence.chainRecord.failureReason}`}`, "");
  if (comparison && comparison.prior) out.push(`Compared with ${comparison.prior.path} (${comparison.prior.observedAt}). Newly surfaced: ${comparison.newlySurfaced.map(x => x.symbol).join(", ") || "none"}.`, "");
  else if (comparison) out.push(`Comparison: ${comparison.reason}`, "");
  const header = out.join("\n");
  const sections = [];
  observations.rows.filter(r => !r.hidden).forEach((row, i) => {
    if (rowIds && !rowIds.includes(row.id)) return;
    const info = evidence.byToken[row.id];
    if (!info) return;
    const out = [];
    out.push(`## ${i + 1}. ${row.name} (${row.symbol}) — ${row.id}`);
    out.push(`Dexscreener ${row.url} · 24h vol ${formatUsd(row.volume24h.value)} · liq ${formatUsd(row.liquidity.value)} · 24h ${formatPercent(row.change24h)} · ${row.valuation.metric || "valuation"} ${formatUsd(row.valuation.value)}`);
    out.push("Measured:");
    for (const f of measuredByToken[row.id] || []) out.push(`- ${f.key} — ${f.text}`);
    if (info.noWebsiteListed) out.push("No website listed in the Dexscreener profile.");
    if (info.links.skippedOverBudget.length) out.push(`Links not read (over budget): ${info.links.skippedOverBudget.join(", ")}`);
    const socials = (row.info.socials || []).map(s => `${s.type || "link"} ${s.url}`);
    if (socials.length) out.push(`Listed socials: ${socials.join("; ")}`);
    for (const id of info.evidenceIds) {
      const r = reads.get(id);
      const status = r.ok ? `HTTP ${r.status}${r.readable ? "" : " — no readable content"}` : `failed — ${r.failureReason}`;
      out.push("", `### ${id} ${r.kind} ${r.finalUrl || r.url} — ${status}${r.ok ? ` · exact contract on page: ${r.addressOnPage ? "yes" : "no"}` : ""}`);
      const file = path.join(workTextDir, `${id}.txt`);
      if (r.ok && fs.existsSync(file)) out.push(fs.readFileSync(file, "utf8").slice(0, config.research.digestTextChars));
    }
    out.push("");
    sections.push(out.join("\n"));
  });
  const parts = [];
  let current = [];
  let size = 0;
  for (const section of sections) {
    if (current.length && size + section.length > PART_CHARS) { parts.push(current); current = []; size = 0; }
    current.push(section);
    size += section.length;
  }
  if (current.length || !parts.length) parts.push(current);
  return parts.map((list, i) => `${header}\nPart ${i + 1} of ${parts.length}.\n\n${list.join("\n")}`);
}

module.exports = {researchDigest};
