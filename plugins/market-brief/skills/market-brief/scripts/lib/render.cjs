"use strict";
const {formatUsd, formatPrice, formatPercent, formatLocalTime, formatLocalDate, finite} = require("./util.cjs");
const {overviewStatus} = require("./research.cjs");

function hostLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function esc(text) {
  return String(text === null || text === undefined ? "" : text).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"})[c]);
}

function mdCell(text) {
  return String(text === null || text === undefined ? "" : text).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function sourcesFor(refs, evidence, research, row) {
  const reads = new Map((evidence && evidence.reads || []).map(r => [r.id, r]));
  const web = new Map((research && research.webReads || []).map(w => [w.id, w]));
  const out = [];
  for (const ref of refs || []) {
    if (reads.has(ref)) { const r = reads.get(ref); out.push({label: `${hostLabel(r.finalUrl || r.url)}${r.kind === "x" ? " (X)" : ""}`, url: r.finalUrl || r.url}); }
    else if (web.has(ref)) { const w = web.get(ref); if (w.url) out.push({label: `${hostLabel(w.url)} (${w.method})`, url: w.url}); }
    else if (ref === "sol-RPC" || ref === "rh-REG") out.push({label: ref === "sol-RPC" ? "Solana RPC" : "Robinhood token registry", url: ref === "rh-REG" ? "https://api.robinhood.com/rhj/assets" : null});
    else if (String(ref).startsWith("measured:")) out.push({label: "Dexscreener", url: row.url});
  }
  const seen = new Set();
  return out.filter(s => { const k = `${s.label}|${s.url}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// Builds the presentation data shared by the Markdown, widget and HTML outputs.
function buildBrief({scope, scopeCfg, config, run, observations, evidence, research, comparison, measuredByToken, stage}) {
  const tz = config.timezone;
  const displayed = observations.rows.filter(r => !r.hidden);
  const projects = new Map((research && research.projects || []).map(p => [p.id, p]));
  const labels = [];
  if (observations.counts.unresolvedPools) labels.push(`${observations.counts.unresolvedPools} of ${observations.counts.discoveredPools} discovered pools unresolved; totals may be understated`);
  if (observations.metrics.failedRequests.length) labels.push(`${observations.metrics.failedRequests.length} pair request attempt(s) failed`);
  if (observations.discoveryStatus !== "ok") labels.push(`discovery ${observations.discoveryStatus}`);
  const rows = displayed.map((row, i) => {
    const project = projects.get(row.id);
    const measured = measuredByToken[row.id] || [];
    const flag = row.flags.find(f => f.code === "mcapExceedsFdv");
    const status = project ? overviewStatus(project) : "not researched";
    const claims = (project && project.claims || []).map(c => ({field: c.field, kind: c.kind, status: c.status, text: c.text, sources: sourcesFor(c.evidence, evidence, research, row)}));
    const aiRefs = project && project.aiView ? project.aiView.basedOn : [];
    return {
      rank: i + 1,
      id: row.id,
      name: row.name,
      symbol: row.symbol,
      url: row.url,
      valuation: {metric: row.valuation.metric, value: row.valuation.value, text: row.valuation.metric === "fdv" ? `FDV ${formatUsd(row.valuation.value)}` : formatUsd(row.valuation.value), label: flag ? ">FDV" : null},
      volume24h: {value: row.volume24h.value, text: formatUsd(row.volume24h.value), label: row.volume24h.partial ? `${row.volume24h.poolsWithValue}/${row.volume24h.poolsTotal} pools` : null},
      liquidity: {value: row.liquidity.value, text: formatUsd(row.liquidity.value), label: row.liquidity.partial ? `${row.liquidity.poolsWithValue}/${row.liquidity.poolsTotal} pools` : null},
      change24h: {value: row.change24h, text: formatPercent(row.change24h)},
      price: {value: row.price, text: formatPrice(row.price)},
      pools: row.pools.length,
      researched: !!project,
      comment: project && project.aiView ? project.aiView.text : null,
      note: {
        status,
        launchLabel: project && project.launch ? project.launch.label || null : null,
        measured: measured.map(m => m.text),
        claims,
        aiView: project && project.aiView ? {text: project.aiView.text, sources: sourcesFor(aiRefs, evidence, research, row)} : null,
        gaps: project ? project.gaps || [] : [],
      },
    };
  });
  const statuses = rows.map(r => r.note.status);
  const researched = rows.filter(r => r.researched).length;
  return {
    schemaVersion: config.schemaVersion,
    scope,
    stage: researched ? "researched" : "list",
    title: `${scopeCfg.label} market brief`,
    chainLabel: scopeCfg.label,
    runId: run.runId,
    producer: run.producer,
    timezone: tz,
    discoveryUrl: observations.discoveryUrl,
    discoveryAt: observations.discoveryAt,
    metricsAt: observations.metrics.window.to,
    researchCompletedAt: research ? research.researchCompletedAt || null : null,
    dateLabel: formatLocalDate(observations.metrics.window.to || observations.discoveryAt, tz),
    timeLabels: {discovery: formatLocalTime(observations.discoveryAt, tz), metrics: formatLocalTime(observations.metrics.window.to, tz), research: research && research.researchCompletedAt ? formatLocalTime(research.researchCompletedAt, tz) : null},
    coverage: {displayed: rows.length, hidden: observations.counts.hiddenTokens, discoveredPools: observations.counts.discoveredPools, resolvedPools: observations.counts.resolvedPools, marketStatus: observations.marketStatus},
    research: {researched, complete: statuses.filter(s => s === "complete").length, partial: statuses.filter(s => s === "partial").length, incomplete: statuses.filter(s => s === "incomplete").length, notResearched: rows.length - researched},
    comparison: comparison ? {prior: comparison.prior, newlySurfaced: comparison.newlySurfaced, noLongerQualifying: comparison.noLongerQualifying, reason: comparison.reason || null} : null,
    materialLabels: labels,
    pageSize: config.pageSize,
    disclaimer: config.brief.disclaimer,
    rows,
  };
}

function metricText(m) {
  return m.label ? `${m.text} (${m.label})` : m.text;
}

function headerLine(brief) {
  const t = brief.timeLabels;
  const parts = [`discovery ${t.discovery}`, `market data ${t.metrics}`];
  if (t.research) parts.push(`research ${t.research}`);
  return `**${brief.chainLabel} · ${brief.coverage.displayed} tokens** — ${parts.join(", ")} ${brief.timezone}, ${brief.dateLabel} · ${brief.coverage.resolvedPools}/${brief.coverage.discoveredPools} pools`;
}

function renderMarkdown(brief) {
  const lines = [headerLine(brief)];
  for (const l of brief.materialLabels) lines.push(`> ${l}`);
  if (brief.comparison && brief.comparison.prior) {
    const c = brief.comparison;
    const fmt = list => list.map(x => x.symbol || x.name).join(", ") || "none";
    lines.push(`Since ${c.prior.observedAt.slice(0, 10)} scan: new ${fmt(c.newlySurfaced)}; dropped ${fmt(c.noLongerQualifying)}.`);
  }
  const pages = Math.max(1, Math.ceil(brief.rows.length / brief.pageSize));
  for (let p = 0; p < pages; p++) {
    const slice = brief.rows.slice(p * brief.pageSize, (p + 1) * brief.pageSize);
    lines.push("");
    if (pages > 1) lines.push(`Page ${p + 1} of ${pages}`, "");
    const withComment = brief.research.researched > 0;
    lines.push(`| # | Token | Mcap | 24h vol | Liquidity | 24h | Pools |${withComment ? " AI comment |" : ""}`, `|--:|---|--:|--:|--:|--:|--:|${withComment ? "---|" : ""}`);
    for (const r of slice) {
      lines.push(`| ${r.rank} | [${mdCell(r.name)}](${r.url}) ${mdCell(r.symbol)} | ${mdCell(metricText(r.valuation))} | ${mdCell(metricText(r.volume24h))} | ${mdCell(metricText(r.liquidity))} | ${r.change24h.text} | ${r.pools} |${withComment ? ` ${mdCell(r.comment || "not researched")} |` : ""}`);
    }
  }
  if (brief.research.researched > 0) {
    lines.push("", "**Notes**");
    for (const r of brief.rows.filter(x => x.researched)) {
      const own = r.note.claims.filter(c => c.kind === "project_claim").slice(0, 2).map(c => c.text);
      const third = r.note.claims.filter(c => c.kind === "third_party").slice(0, 1).map(c => `third party: ${c.text}`);
      const bits = [];
      if (own.length) bits.push(`Project says: ${own.join(" ")}`);
      if (third.length) bits.push(third[0]);
      if (r.note.launchLabel) bits.push(`_${r.note.launchLabel}_`);
      if (r.note.status !== "complete" && r.note.gaps.length) bits.push(`Missing: ${r.note.gaps.map(g => `${g.what} (${g.reason})`).join("; ")}`);
      const sources = [...new Map([...r.note.claims.flatMap(c => c.sources)].filter(s => s.url).map(s => [s.url, s])).values()].slice(0, 3);
      if (sources.length) bits.push(sources.map(s => `[${s.label}](${s.url})`).join(", "));
      lines.push(`- **${mdCell(r.name)}** (${r.note.status}) — ${bits.join(" · ") || "No project-controlled evidence this run."}`);
    }
  }
  if (brief.research.notResearched > 0) lines.push("", "Reply `research <symbol>` (or the contract) for a deep dive on any row.");
  lines.push("", `_${brief.disclaimer}_`);
  return lines.join("\n") + "\n";
}

function safeJson(data) {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

// Compact payload for the widget: rows are drawn by the client script, so nothing is duplicated.
function compactData(brief) {
  return {
    s: brief.chainLabel, id: brief.runId, at: brief.metricsAt, ps: brief.pageSize,
    rows: brief.rows.map(r => ({
      i: r.id, n: r.name, y: r.symbol, u: r.url,
      v: r.valuation.text, vl: r.valuation.label, o: r.volume24h.text, ol: r.volume24h.label,
      l: r.liquidity.text, ll: r.liquidity.label, c: r.change24h.text, cv: finite(r.change24h.value) ? Math.sign(r.change24h.value) : 0, p: r.pools,
      st: r.note.status, la: r.note.launchLabel,
      m: [...r.note.measured, ...r.note.claims.filter(c => c.kind === "measured").map(c => c.text)],
      k: r.note.claims.filter(c => c.kind !== "measured").map(c => [c.kind === "third_party" ? 1 : 0, c.text, c.status === "verified" ? 1 : 0, c.sources.filter(x => x.url).map(x => [x.label, x.url])]),
      a: r.note.aiView ? r.note.aiView.text : null,
      g: r.note.gaps.map(g => [g.what, g.reason]),
    })),
  };
}

const CLIENT_SCRIPT = `
(function(){
var root=document.getElementById(ROOT_ID),d=JSON.parse(root.querySelector('script[type="application/json"]').textContent);
var size=d.ps||12,page=0,pages=Math.max(1,Math.ceil(d.rows.length/size)),tb=root.querySelector('tbody'),pg=root.querySelector('.pg'),pi=root.querySelector('.pi');
function e(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function lb(t){return t?' <span class="lbl">'+e(t)+'</span>':''}
function row(r,i){return '<tr><td class="n">'+(i+1)+'</td><td class="tk"><a href="'+e(r.u)+'" target="_blank" rel="noopener">'+e(r.n)+'</a> <span class="sym">'+e(r.y)+'</span></td><td class="n">'+e(r.v)+lb(r.vl)+'</td><td class="n">'+e(r.o)+lb(r.ol)+'</td><td class="n">'+e(r.l)+lb(r.ll)+'</td><td class="n '+(r.cv>0?'up':r.cv<0?'dn':'')+'">'+e(r.c)+'</td><td class="n">'+r.p+'</td><td class="act"><button type="button" data-notes="'+i+'">Notes</button></td></tr>'}
function src(a){return a.map(function(x){return '<a href="'+e(x[1])+'" target="_blank" rel="noopener">'+e(x[0])+'</a>'}).join(', ')}
function ul(a,f){return '<ul>'+a.map(f).join('')+'</ul>'}
function notes(r,i){var h='<div class="nt"><p class="muted">'+(r.st==='not researched'?'Not researched yet':'Overview '+e(r.st))+(r.la?' · '+e(r.la):'')+'</p>';
if(r.k.length){h+='<p class="hd">Project says</p>'+ul(r.k,function(c){return '<li>'+(c[0]?'<span class="muted">Third party: </span>':'')+e(c[1])+(c[2]?' <span class="lbl">verified</span>':'')+(c[3].length?' <span class="muted">('+src(c[3])+')</span>':'')+'</li>'})}
if(r.m.length){h+='<p class="hd">Measured</p>'+ul(r.m,function(m){return '<li>'+e(m)+'</li>'})}
if(r.a){h+='<p class="hd">AI view</p><p>'+e(r.a)+'</p>'}
if(r.g.length){h+='<p class="hd">Missing evidence</p>'+ul(r.g,function(g){return '<li>'+e(g[0])+': '+e(g[1])+'</li>'})}
return h+'<p><button type="button" data-research="'+i+'">Research '+e(r.y)+' &#8599;</button></p></div>'}
function show(){var h='';for(var i=page*size;i<Math.min(d.rows.length,(page+1)*size);i++)h+=row(d.rows[i],i);tb.innerHTML=h;pi.textContent=pages>1?'Page '+(page+1)+' of '+pages:'';pg.style.display=pages>1?'':'none'}
root.addEventListener('click',function(ev){var b=ev.target.closest('button');if(!b)return;
if(b.hasAttribute('data-notes')){var i=+b.getAttribute('data-notes'),tr=b.closest('tr'),nx=tr.nextElementSibling;if(nx&&nx.classList.contains('nr')){nx.remove();b.textContent='Notes';return}var nr=document.createElement('tr');nr.className='nr';nr.innerHTML='<td colspan="8">'+notes(d.rows[i],i)+'</td>';tr.after(nr);b.textContent='Hide';return}
if(b.hasAttribute('data-research')){var r=d.rows[+b.getAttribute('data-research')],msg='Research '+r.n+' ('+r.i+') from the '+d.s+' brief, run '+d.id+', market data observed '+d.at+'. Dexscreener: '+r.u;if(typeof sendPrompt==='function'){sendPrompt(msg)}else if(navigator.clipboard){navigator.clipboard.writeText(msg);b.textContent='Copied research request'}return}
if(b.classList.contains('prev')&&page>0){page--;show()}if(b.classList.contains('next')&&page<pages-1){page++;show()}});
show()})();`;

function widgetBody(brief, rootId) {
  const t = brief.timeLabels;
  const meta = `${brief.chainLabel} · ${brief.coverage.displayed} tokens · discovery ${t.discovery}, market data ${t.metrics}${t.research ? `, research ${t.research}` : ""} ${brief.timezone}, ${brief.dateLabel} · ${brief.coverage.resolvedPools}/${brief.coverage.discoveredPools} pools`;
  const labels = brief.materialLabels.map(l => `<p class="warn">${esc(l)}</p>`).join("");
  const head = `<table class="mb"><thead><tr><th class="n">#</th><th>Token</th><th class="n">Mcap</th><th class="n">24h vol</th><th class="n">Liquidity</th><th class="n">24h</th><th class="n">Pools</th><th></th></tr></thead><tbody></tbody></table>`;
  return `<div id="${rootId}" class="mbw">\n<h2 class="sr-only">${esc(brief.chainLabel)} tokens from the Dexscreener discovery page, sorted by 24h volume.</h2>\n<p class="meta">${esc(meta)}</p>${labels}\n<div class="tw">${head}</div>\n<div class="pg"><button type="button" class="prev" aria-label="Previous page">Previous</button><span class="pi"></span><button type="button" class="next" aria-label="Next page">Next</button></div>\n<p class="meta">${esc(brief.disclaimer)}</p>\n<script type="application/json">\n${safeJsonLines(compactData(brief))}\n</script>\n</div>`;
}

// One row per line keeps the file readable in pieces and diff-friendly.
function safeJsonLines(data) {
  const {rows, ...rest} = data;
  const head = safeJson(rest).slice(0, -1);
  return `${head},"rows":[\n${rows.map(r => safeJson(r)).join(",\n")}\n]}`;
}

const WIDGET_STYLE = `<style>.mbw{font-size:13px}.mbw .meta{color:var(--text-secondary);margin:0 0 8px}.mbw .warn{color:var(--text-warning);margin:0 0 6px}.mbw .tw{overflow-x:auto}.mbw table.mb{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.mbw th,.mbw td{padding:6px 6px;border-bottom:0.5px solid var(--border);text-align:left;vertical-align:top}.mbw th{font-weight:500;color:var(--text-secondary)}.mbw .n{text-align:right;white-space:nowrap}.mbw .tk{max-width:180px}.mbw .sym,.mbw .muted{color:var(--text-secondary)}.mbw .lbl{font-size:11px;color:var(--text-warning)}.mbw .up{color:var(--text-success)}.mbw .dn{color:var(--text-danger)}.mbw .act{text-align:right}.mbw .pg{display:flex;gap:8px;align-items:center;margin:8px 0}.mbw .nt p{margin:4px 0}.mbw .nt ul{margin:2px 0 6px 18px;padding:0}.mbw .hd{font-weight:500;margin-top:8px}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style>`;

function renderWidget(brief) {
  const id = `mb-${brief.scope}-${brief.runId.replace(/[^a-zA-Z0-9]/g, "")}`;
  return `${WIDGET_STYLE}\n${widgetBody(brief, id)}\n<script>${CLIENT_SCRIPT.replace("ROOT_ID", JSON.stringify(id))}</script>\n`;
}

function renderHtml(brief) {
  const id = `mb-${brief.scope}`;
  const tokens = `:root{--text-primary:#0b0b0b;--text-secondary:#52514e;--text-success:#2f6f12;--text-danger:#a32d2d;--text-warning:#854f0b;--border:rgba(11,11,11,.12);--bg:#fcfcfb}@media (prefers-color-scheme:dark){:root{--text-primary:#f0efec;--text-secondary:#c3c2b7;--text-success:#97c459;--text-danger:#f09595;--text-warning:#fac775;--border:rgba(255,255,255,.14);--bg:#1a1a19}}body{margin:0;padding:16px;background:var(--bg);color:var(--text-primary);font-family:system-ui,-apple-system,sans-serif}a{color:inherit}button{font:inherit;background:transparent;color:inherit;border:0.5px solid var(--text-secondary);border-radius:8px;padding:4px 10px;cursor:pointer}h1{font-size:18px;font-weight:500;margin:0 0 8px}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brief.chainLabel)} brief ${esc(brief.dateLabel)}</title><style>${tokens}</style>${WIDGET_STYLE}</head><body><h1>${esc(brief.title)}</h1>${widgetBody(brief, id)}<script>${CLIENT_SCRIPT.replace("ROOT_ID", JSON.stringify(id))}</script></body></html>\n`;
}

module.exports = {buildBrief, renderMarkdown, renderWidget, renderHtml, hostLabel};
