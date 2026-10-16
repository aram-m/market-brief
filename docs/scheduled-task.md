# Daily schedule

The brief runs as a Claude Desktop scheduled task on the Mac. Discovery uses Claude's built-in browser, one fresh load per page (Dexscreener challenges plain HTTP; the built-in browser passed on first loads but was challenged after repeated loads on 16 Oct 2026). There is no cloud routine.

| Setting | Value |
| --- | --- |
| Name | Daily Market Brief (Claude) |
| When | Every day at 11:00 Asia/Yerevan (07:00 UTC). Desktop starts tasks a few minutes after the set time. |
| Folder | `~/Desktop/projects/market-brief` |
| Needs | Mac awake and Claude Desktop open at 11:00; `market-brief-data/` checked out on the `reports` branch |
| Status | **Active** as `market-brief-daily` (created 16 Oct 2026): list only, saved locally, no push. |

The Codex `daily-market-brief` automation is no longer present, so only this task loads Dexscreener at 11:00.

## Prompt (summary of the live task)

```text
Run the market-brief skill for both scopes (sol and rh) as a LIST ONLY, saved locally.
Data folder: ./market-brief-data (the reports branch worktree).
Follow SKILL.md steps 1, 2 and 3, then step 8 (finalize). Skip the deep-dive steps 4-7 and step 9 (publish).
Discovery: Claude's built-in browser, one load per page; if it shows a challenge, record discovery as blocked for that scope and do not click it or switch browsers.
Show each brief-<scope>.md, end with the "reply research <symbol>" line and the disclaimer.
Do not run evidence or web reads, commit, push, change schedules, config, preferences or filters, or place trades.
```

To publish each run, add a step: in ./market-brief-data, commit only the new run folder (never work/) and push the reports branch.

## Changing it

Edit or pause it from Claude Desktop (Scheduled in the sidebar), or ask Claude in this folder to update `market-brief-daily`. Use Run now to test a change before the next 11:00 run.
