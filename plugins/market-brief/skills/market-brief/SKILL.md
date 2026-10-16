---
name: market-brief
description: "Daily Solana and Robinhood token briefs from Dexscreener trending discovery: exact-identity pool aggregation, saved display exclusions, sourced project research and concise AI commentary, saved as a complete report. Use for 'sol', 'rh', 'check sol', 'check rh', 'market brief', 'daily brief', '<sol|rh> all', or '<sol|rh> <project or contract>'."
argument-hint: "[sol|rh|daily] [all|<project or contract>]"
---

# Market Brief

Two scopes, `sol` (Solana) and `rh` (Robinhood); `daily` runs both. A bare scope or `<scope> all` produces the full brief. `<scope> <project or contract>` asks about one project. For that, reuse the latest saved run (see Follow-ups) instead of running discovery again.

Rules: [reporting-rules.md](references/reporting-rules.md). Research format: [research-schema.md](references/research-schema.md). Settings: [config.json](references/config.json). Read the rules before the first run in a session.

Scripts need Node 18+ and no packages. Below, `mb <command>` means:

```bash
node "${CLAUDE_SKILL_DIR}/scripts/mb.cjs" <command> [flags]
```

Write the full command each time; a shell variable holding `node …` does not word-split in zsh.

Reports go to the data folder: `--data DIR`, else `$MARKET_BRIEF_DATA`, else `./market-brief-data`. Hidden tokens live in `<data>/preferences.json`. If the folder doesn't exist, run `mb init-data` first.

## Run

1. **Start:** `mb new-run --scopes sol,rh` (or one scope). Keep the printed `runDir`.
2. **Discover each scope in a real browser.** Use the browser the user names, otherwise `discoveryBrowser.default` in config.json (Claude's built-in browser). Load each page once per run, in a fresh tab. Never switch browsers on your own. If the chosen browser isn't connected, record discovery as blocked with that reason.
   - Built-in browser: open the page with the browser pane's preview_start (url) or navigate tool. Claude in Chrome: get the tab context, open a new tab in the MCP group, and close it when discovery is done.
   - Navigate to the scope's `discoveryUrl` from config.json.
   - Run the script printed by `mb discovery-script` with the browser's JavaScript tool. It waits for the table and returns JSON.
   - If `challenge` is true ("Just a moment", "Verify you are human"): don't click, solve or retry around it. Save the JSON anyway; that scope then reports `discovery blocked`. The user may clear the check themselves and ask for a rerun.
   - Write the returned JSON verbatim to `<runDir>/work/discovery-page-<scope>.json`, then run `mb save-discovery --run <runDir> --scope <scope> --input <that file> --method <claude-in-chrome|claude-built-in-browser>`. A checksum mismatch means the list was copied wrongly: run the extraction script again on the same page (no reload) and save again.
   - Load a second page only if the first returned 100 rows and `nextPage: true`. Pass both page results as a JSON array.
3. **Market data:** `mb collect --run <runDir>`. Right away, show each scope's `brief-<scope>.md` in chat (Research pending). Don't wait for research.
4. **Evidence:** `mb evidence --run <runDir>`. Then read every file listed in `digestParts` (`<runDir>/work/research-input-<scope>-N.md`): measured facts, every read and its extracted text. Each part fits one file read. The script's own page reads, failed ones included, count toward the 3-reads-per-project budget; whatever is left is the WebFetch allowance.
5. **Research:** write `<runDir>/research-<scope>.json` per research-schema.md, one entry for every displayed row. For a row still lacking purpose or mechanics, you may run 1 WebSearch to find official docs or GitHub, then WebFetch within the per-project budget. Record each WebSearch and WebFetch in `webReads`. Base claims only on this run's reads. If many rows need it, you may split them across subagents, each given the schema and its rows' digest sections.
6. **Validate:** `mb validate --run <runDir>`. Fix every error and re-run until `ok: true`.
7. **Deliver:** `mb render --run <runDir> --stage final`.
   - Show `brief-<scope>.md` for each scope.
   - Then show `widget-<scope>.html` with the visualize widget tool: read its guide first, and pass the file content as is. The file holds one JSON line per row; copy it completely.
   - If no widget tool is available, the Markdown alone is the brief.
8. **Finish:** `mb finalize --run <runDir>` writes `coverage.json` and `README.md`. Give report paths only when asked.
9. **Publish** only when the invocation says to (for example the scheduled task). Commit only this run's folder in the data checkout and push its branch. Never commit `work/`.

## Presentation

- The compact table with real timestamps, then one short note per row. No methodology block or routine caveats; those stay in the saved report.
- Material labels (partial pools, unresolved pools, blocked discovery, `>FDV`) go next to the affected metric.
- Notes separate what the project says, what was measured and the AI view. Any missing evidence is named.
- A recent pool is "pool first seen", never a launch. Label releases only as the schema allows.
- If a scope failed, say which step failed, and don't show an older scan in its place.
- End with the disclaimer line. Never place trades or suggest position sizes.

## Follow-ups

- **"Research X":** the widget button sends the exact id, run and observation time. Reuse that run's observations. Research only that row within its budget, answer with sources, and update `research-<scope>.json` plus a re-render only if asked.
- **`<scope> <project or contract>`:** find the latest run folder for that scope in the data folder, match by exact id or symbol, and show that row's note. If it's from an earlier time today or an earlier day, say when it was observed.
- **Hide or unhide a token:** only on an explicit request. Edit `<data>/preferences.json` (exact `chain:address` id plus a reason and date).
