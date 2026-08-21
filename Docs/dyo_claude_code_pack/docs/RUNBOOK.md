# MVP Runbook

## Start order
1. Start Contabo database/API/web.
2. Start Windows DYO Worker.
3. Worker verifies local dependencies.
4. Start/verify AE + ae-mcp when required by the job.
5. Confirm dashboard worker health.

## Worker health target

```text
Worker: ONLINE
AE: ONLINE
MCP: ONLINE
Last heartbeat: fresh
Current job: none or valid job id
maxConcurrency: 1
```

## Job execution
1. Create/upload intake.
2. Run preflight.
3. Inspect template.
4. Review dynamic mapping table.
5. Approve mapping.
6. Execute first frame.
7. Approve style.
8. Apply branding/typography.
9. Approve branding.
10. Execute remaining scenes.
11. Create landscape.
12. Create native Reels.
13. Review final previews.
14. Approve final.
15. Run separate render.

## MCP/AE issue
If AE process exists but heartbeat stops:
- do not loop timeouts indefinitely,
- mark `AE_MODAL_SUSPECTED` or `AE_HEARTBEAT_LOST`,
- checkpoint,
- ask for required human action if necessary,
- reconnect only when appropriate,
- verify health,
- resume from last valid checkpoint.

## Original safety
Before mutation:
- hash source `.aep`,
- create job copy/version,
- use only job copy for modifications.

After completion:
- re-hash original and verify unchanged.
