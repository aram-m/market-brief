---
name: market-brief
description: "Daily Solana and Robinhood token lists from Dexscreener trending discovery, with exact-identity pool aggregation and saved display exclusions. Sourced project research and AI commentary run per token on request. Use for 'sol', 'rh', 'check sol', 'check rh', 'market brief', 'daily brief', '<sol|rh> all', 'research <symbol or contract>', or '<sol|rh> <project or contract>'."
argument-hint: "[sol|rh|daily] [all|research <symbol>|<project or contract>]"
---

# Market Brief

Two scopes, `sol` (Solana) and `rh` (Robinhood); `daily` runs both.

- **List first:** a bare scope, `<scope> all` or `daily` produces the token list only: discovery, market data and measured facts, with no project research.
- **Deep dive on request:** `research <symbol or contract>` researches only that row in the latest run (steps 4–8). `research all` researches every displayed row.
- **One project:** `<scope> <project or contract>` reuses the latest saved run (see Follow-ups) instead of running discovery again.

Rules: [reporting-rules.md](references/reporting-rules.md). Research format: [research-schema.md](references/research-schema.md). Settings, including each chain's discovery filters: [config.json](references/config.json). Read the rules before the first run in a session.

Scripts need Node 18+ and no packages. Below, `mb <command>` means:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mb.cjs" <command> [flags]
```

Write the full command each time; a shell variable holding `node …` does not word-split in zsh.

Reports go to the data folder: `--data DIR`, else `$MARKET_BRIEF_DATA`, else `./market-brief-data`. Hidden tokens live in `<data>/preferences.json`. If the folder doesn't exist, run `mb init-data` first.

## List (every run)

1. **Start:** `mb new-run --scopes sol,rh` (or one scope). Keep the printed `runDir`.
2. **Discover each scope in a real browser.** Use the browser the user names, otherwise `discoveryBrowser.default` in config.json (Claude's built-in browser). Load each page once per run, in a fresh tab. Never switch browsers on your own. If the chosen browser isn't connected, record discovery as blocked with that reason.
   - Built-in browser: open the page with the browser pane's preview_start (url) or navigate tool. Claude in Chrome: get the tab context, open a new tab in the MCP group, and close it when discovery is done.
   - Navigate to the scope's `discoveryUrl` from config.json.
   - Run the script printed by `mb discovery-script` with the browser's JavaScript tool. It waits for the table and returns JSON.
   - If `challenge` is true ("Just a moment", "Verify you are human"): don't click, solve or retry around it. Save the JSON anyway; that scope then reports `discovery blocked`. The user may clear the check themselves and ask for a rerun.
   - Write the returned JSON verbatim to `<runDir>/work/discovery-page-<scope>.json`, then run `mb save-discovery --run <runDir> --scope <scope> --input <that file> --method <claude-in-chrome|claude-built-in-browser>`. A checksum mismatch means the list was copied wrongly: run the extraction script again on the same page (no reload) and save again.
   - Load a second page only if the first returned 100 rows and `nextPage: true`. Pass both page results as a JSON array.
3. **Market list:** `mb collect --run <runDir>`. Show each scope's `brief-<scope>.md` in chat. It has the table with real timestamps and no comment column, and ends with the "reply `research <symbol>`" line. Then go to step 8. Steps 4–7 run only when the user asks for research.

## Deep dive (only on request)

4. **Evidence:** `mb evidence --run <runDir> --scope <scope> --id <symbol or contract>[,...]` (omit `--id` for `research all`). It reads each requested row's site, docs, GitHub and listed X account. The first time, it also makes the one chain read covering all displayed rows. A row already read in this run isn't read again.
   - Read every file listed in `digestParts` (`<runDir>/work/research-input-<scope>[-<symbols>]-N.md`). They hold the measured facts, every read and its extracted text, and each part fits one file read.
   - The script's own page reads, failed ones included, count toward the 3-reads-per-project budget. Whatever is left is the WebFetch allowance.
5. **Research:** add an entry for each requested row to `<runDir>/research-<scope>.json`, following research-schema.md. Create the file if it's missing, and keep earlier entries.
   - For a row still lacking purpose or mechanics, you may run 1 WebSearch to find official docs or GitHub, then WebFetch within the per-project budget.
   - Record each WebSearch and WebFetch in `webReads`, continuing the `W` numbering.
   - Base claims only on this run's reads. For `research all` with many rows, you may split the rows across subagents, each given the schema and its rows' digest sections.
6. **Validate:** `mb validate --run <runDir>` (`--all` after `research all`). Fix every error and re-run until `ok: true`.
7. **Deliver:** `mb render --run <runDir>`.
   - Show the researched row's note. Use the matching lines of `brief-<scope>.md`, or the whole brief after `research all`.
   - On request, show `widget-<scope>.html` with the visualize widget tool: read its guide first, and pass the file content as is. The file holds one JSON line per row; copy it completely.
   - Rows without research say "not researched".

## Finish

8. **Finish:** `mb finalize --run <runDir>` writes `coverage.json` and `README.md`. Run it after the list and again after any deep dive. Give report paths only when asked.
9. **Publish** only when the invocation says to. Commit only this run's folder in the data checkout and push its branch. Never commit `work/`.

## Presentation

- The compact table with real timestamps. No methodology block or routine caveats; those stay in the saved report.
- Material labels (partial pools, unresolved pools, blocked discovery, `>FDV`) go next to the affected metric.
- Notes for researched rows separate what the project says, what was measured and the AI view. Any missing evidence is named.
- A recent pool is "pool first seen", never a launch. Label releases only as the schema allows.
- If a scope failed, say which step failed, and don't show an older scan in its place.
- End with the disclaimer line. Never place trades or suggest position sizes.

## Follow-ups

- **"research X":** the user's reply or the widget button gives a symbol, contract or exact id. Use the latest run that lists it; if it's from an earlier day, say when it was observed. Then run steps 4–8 for that row only.
- **`<scope> <project or contract>`:** find the latest run folder for that scope in the data folder and match by exact id or symbol. Show that row's metrics, measured facts and any saved note. Offer a deep dive if it has none.
- **Hide or unhide a token:** only on an explicit request. Edit `<data>/preferences.json` (exact `chain:address` id plus a reason and date).
