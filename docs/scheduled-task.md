# Daily schedule

The brief runs as a Claude Desktop scheduled task on the Mac. Discovery uses Claude in Chrome (your own Chrome profile), one load per page. Dexscreener challenges plain HTTP, and the built-in browser was challenged even in a fresh session (17 Oct 2026). There is no cloud routine.

| Setting | Value |
| --- | --- |
| Name | Daily Market Brief (Claude) |
| When | Every day at 11:00 Asia/Yerevan (07:00 UTC). Desktop starts tasks a few minutes after the set time. |
| Folder | `~/Desktop/projects/market-brief` |
| Needs | Mac awake, Claude Desktop open, and Chrome open with the Claude in Chrome extension signed in at 11:00; `market-brief-data/` checked out on the `reports` branch |
| Status | **Active** as `market-brief-daily` (created 16 Oct 2026): list only, saved locally, no push. |

The Codex `daily-market-brief` automation is no longer present, so only this task loads Dexscreener at 11:00.

## Prompt (summary of the live task)

```text
Run the market-brief skill for both scopes (sol and rh) as a LIST ONLY, saved locally.
Data folder: ./market-brief-data (the reports branch worktree).
Follow SKILL.md steps 1, 2 and 3, then step 8 (finalize). Skip the deep-dive steps 4-7 and step 9 (publish).
Discovery: Claude in Chrome, one tab, one load per page, tab closed afterwards. The JavaScript summary gives rowCount, checksum, path and params; the pool addresses come from the page's accessibility tree (save-discovery --slugs). If Chrome isn't connected, record both scopes with save-discovery --unavailable; if a page shows a challenge, record that scope as blocked. Never click a challenge, reshape addresses to pass the extension's filter, or switch browsers.
Show each brief-<scope>.md, end with the "reply research <symbol>" line and the disclaimer.
Do not run evidence or web reads, commit, push, change schedules, config, preferences or filters, or place trades.
```

To publish each run, add a step: in ./market-brief-data, commit only the new run folder (never work/) and push the reports branch.

## Changing it

Edit or pause it from Claude Desktop (Scheduled in the sidebar), or ask Claude in this folder to update `market-brief-daily`. Use Run now to test a change before the next 11:00 run.
