# Daily schedule (prepared, not active)

The brief runs as a Claude Desktop scheduled task on the Mac. Discovery uses Claude's built-in browser, one fresh load per page (Dexscreener challenges plain HTTP; the built-in browser passed on first loads but was challenged after repeated loads on 16 Oct 2026). There is no cloud routine.

| Setting | Value |
| --- | --- |
| Name | Daily Market Brief (Claude) |
| When | Every day at 11:00 Asia/Yerevan (07:00 UTC). Desktop starts tasks a few minutes after the set time. |
| Folder | `~/Desktop/projects/market-brief` |
| Needs | Mac awake, Claude Desktop open, `market-brief-data/` checked out on the `reports` branch, git push access to `aram-m/market-brief` |
| Status | **Not active.** Create it only after the publish step is approved. |

Before you activate it, pause the Codex `daily-market-brief` automation (also 11:00) yourself, so both don't load Dexscreener at the same time.

## Prompt

```text
Run the market-brief skill for the daily brief (both scopes: sol and rh) in this folder.
Data folder: ./market-brief-data (the reports branch worktree). Use Claude's built-in browser for discovery, one load per page; if it shows a challenge, record discovery as blocked for that scope and do not switch browsers or click the challenge.
Follow the skill's steps 1-8 exactly: market tables first, then research, validation, the final Markdown briefs and the widgets.
Publish: in ./market-brief-data, commit only the new run folder (never work/) with the message "brief: <runId>" and push the reports branch. If the push fails, say so; do not retry with other credentials.
Finish with one line per scope: discovery status, displayed tokens, research complete/partial/incomplete.
```

## Activating

Activate it from Claude Desktop (Schedule, then New task), or ask Claude in this folder to create the scheduled task from the prompt above. Use the run-once option to test it before relying on the schedule. The task appears under Scheduled in the sidebar.
