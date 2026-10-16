# Market Brief

A Claude skill that produces a daily brief of trending Solana and Robinhood Chain tokens from Dexscreener. Each run:

- **Discovery:** loads the Dexscreener discovery page (Trending 6H, market cap ≥ $1M, pool age ≥ 72 h, pool 24h volume ≥ $1M, profile enabled) in a real browser.
- **Market data:** fetches pool metrics from Dexscreener's public pair API in batches.
- **Aggregation:** aggregates pools by exact token contract and applies your saved display exclusions.
- **Research:** reads each project's own site, docs, GitHub and listed X account, plus one chain read per scope. Claude then writes short sourced notes and an AI comment for every displayed token.
- **Report:** saves observations, evidence, coverage failures and the full report, and shows a paginated table in chat.

> Not financial advice. Market data comes from Dexscreener. Project statements are the projects' own claims unless marked verified. The skill never trades.

## Install

In Claude Code:

```text
/plugin marketplace add aram-m/market-brief
/plugin install market-brief@market-brief
```

Or clone this repository and open it in Claude Code; the skill is also available as a project skill (`.claude/skills/market-brief`).

Requirements:

- **Node.js 18 or later.** The scripts use only built-in modules.
- **A browser Claude can drive.** The discovery page is behind a Cloudflare challenge for plain HTTP, so it needs a real browser. The default is the Claude Desktop built-in browser, with one load per page. Claude in Chrome also works if you name it. Repeated loads can trigger an interactive check; the skill reports that and never solves it.
- **Unrestricted network access** to `api.dexscreener.com`, project websites, `api.mainnet-beta.solana.com` and `api.robinhood.com`.

Cloud sessions are not supported. Discovery needs the browser, and the default cloud network allowlist blocks these hosts.

## Use

| Say | You get |
| --- | --- |
| `sol` / `check sol` / `sol all` | Full Solana brief |
| `rh` / `check rh` / `rh all` | Full Robinhood brief |
| `daily` / `market brief` | Both |
| `sol <project or contract>` | That project's note from the latest saved run |

The brief arrives in two steps. First comes the market table, marked "research pending". Then the final table follows, with notes and an interactive widget: 12 rows per page, names open Dexscreener, and Notes and Research buttons on each row.

The skill runs these steps through `plugins/market-brief/skills/market-brief/scripts/mb.cjs`:

```bash
node plugins/market-brief/skills/market-brief/scripts/mb.cjs help
```

## Data folder

Reports and your display exclusions live outside the skill code, in the data folder. The path is `--data DIR`, else `$MARKET_BRIEF_DATA`, else `./market-brief-data`.

```text
market-brief-data/
  preferences.json                         hidden tokens: [{"id": "solana:<mint>", "reason": "...", "addedAt": "YYYY-MM-DD"}]
  reports/market-checks/YYYY-MM-DD/HHmmss-claude-<label>/
    run.json  budget.json  coverage.json  README.md
    discovery-<scope>.json   raw/pairs-<scope>.json   observations-<scope>.json
    evidence-<scope>.json    research-<scope>.json    comparison-<scope>.json
    brief-<scope>.{json,md,html}   widget-<scope>.html
    work/                                  local research text; not published
```

In this repository, the data folder is a worktree of the `reports` branch:

```bash
git worktree add market-brief-data reports
```

Comparisons only use earlier Claude runs with the same scope, discovery URL and schema.

## Rules

[reporting-rules.md](plugins/market-brief/skills/market-brief/references/reporting-rules.md) covers discovery, identity, aggregation, exclusions, request budgets and delivery. [research-schema.md](plugins/market-brief/skills/market-brief/references/research-schema.md) covers how notes keep measured facts, project claims and AI interpretation apart. Filters, budgets and the stablecoin list are in [config.json](plugins/market-brief/skills/market-brief/references/config.json) and [excluded-base-assets.json](plugins/market-brief/skills/market-brief/references/excluded-base-assets.json).

## Daily schedule

[docs/scheduled-task.md](docs/scheduled-task.md) has the prompt for a Claude Desktop scheduled task at 11:00 Asia/Yerevan. It isn't active.

## Tests

```bash
npm test
```

The tests replay the saved 16 October 2026 Dexscreener responses (`tests/fixtures/`) and check the totals, exclusions, sorting, partial sums, failure records and research validation.
