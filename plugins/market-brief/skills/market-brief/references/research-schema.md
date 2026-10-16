# Research file: `research-<scope>.json`

Claude writes one file per scope after `mb.cjs evidence`, adding an entry for each row the user asked to research (deep dives can add rows to the same file later in the run). `mb.cjs validate` checks it, and the renderer builds notes from it. Market data is never written by the model: measured facts come from the scripts.

```json
{
  "schemaVersion": 1,
  "scope": "sol",
  "runId": "<run.json runId>",
  "researchStartedAt": "2026-10-16T07:00:00.000Z",
  "researchCompletedAt": "2026-10-16T07:04:00.000Z",
  "webReads": [
    {"id": "W1", "tokenId": "solana:<mint>", "method": "websearch", "query": "ORE ore.supply docs mining", "url": "https://docs.ore.supply", "observedAt": "...", "status": "ok", "note": "found docs.ore.supply"},
    {"id": "W2", "tokenId": "solana:<mint>", "method": "webfetch", "url": "https://docs.ore.supply", "observedAt": "...", "status": "ok", "note": "summary of how mining works"}
  ],
  "projects": [
    {
      "id": "solana:<mint>",
      "claims": [
        {"field": "purpose", "kind": "project_claim", "status": "claimed_unverified", "text": "Describes itself as ...", "evidence": ["sol-E3"]},
        {"field": "mechanics", "kind": "project_claim", "status": "claimed_unverified", "text": "Says ...", "evidence": ["W2"]},
        {"field": "supply", "kind": "measured", "status": "verified", "text": "Mint authority is renounced.", "evidence": ["sol-RPC", "measured:mintAuthority"]}
      ],
      "aiView": {"text": "One or two sentences of interpretation.", "basedOn": ["measured:volumeToLiquidity", "sol-E3"]},
      "launch": {"label": null, "evidence": []},
      "gaps": [{"what": "mechanics", "reason": "site is JavaScript-only; no readable text", "source": "https://..."}]
    }
  ]
}
```

## Rules

- One entry per researched row, for displayed (non-hidden) rows only. Rows without an entry are shown as "not researched". `mb validate --all` additionally requires every displayed row.
- `field`: purpose, mechanics, provenance, supply, adoption, launch or risk.
- `kind`:
  - `project_claim`: what the project's own site, docs, GitHub or listed X account says.
  - `third_party`: anything else, including X posts from accounts not listed in the token's Dexscreener profile.
  - `measured`: restates a measured fact or chain read; may cite only `measured:*`, `sol-RPC` or `rh-REG`.
- `status`: `claimed_unverified` for every project or third-party statement. `verified` only when a measured fact or chain read supports it.
- `evidence` and `aiView.basedOn` may cite: this run's evidence ids (`sol-E3`), chain reads (`sol-RPC`, `rh-REG`), measured keys for the same row (`measured:poolAge`) and your own `webReads` ids. A read that failed or had no readable content cannot be cited; record it in `gaps`.
- Write claims as reported speech ("Says…", "Describes…"), at most 220 characters each. Never invent mechanics from a ticker, slogan or logo.
- `aiView.text`: at most 240 characters. Add what the columns don't show: a ratio, an anomaly, a pool-coverage or quote-asset change, a mismatch between claim and measurement, or the specific evidence gap. Don't restate column values on their own.
- `launch.label`: `null`, `"newly discovered"`, `"launch date unverified"` or `"verified launch YYYY-MM-DD"`. A verified launch needs dated release evidence other than `measured:poolAge`, and X alone is not enough. Pool creation is never a launch.
- `gaps`: required unless the overview is complete. The overview status is computed: complete = project claims for both purpose and mechanics; partial = at least one project claim; incomplete = none.
- A WebSearch entry may carry the `url` of the result its claims rely on, so the note can link it.
- Budget per project: plain page reads (including failed ones) plus WebFetch at most 3, and at most 1 WebSearch, used only for rows still incomplete after the script's reads. Record every WebSearch and WebFetch in `webReads`, including failures (`status: "failed"`).
- Use only this run's reads. Never carry a claim forward from an earlier run.
