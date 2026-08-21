# Error Handling & Recovery

Use explicit error categories:
validation, auth, conflict/state, infrastructure, external process, AE/MCP disconnect, suspected AE modal, retryable, human-action-required, terminal.

Do not throw raw strings or swallow errors.

Every spawned process must define:
- allowlisted command
- timeout
- stdout/stderr capture
- exit-code handling
- cancellation
- correlation/job ID
- safe argument handling

Never pass user text directly into shell strings.

Before risky AE operations:
1. validate state
2. persist checkpoint
3. execute
4. verify result
5. persist completion

If heartbeat disappears, stop blind retries, enter the correct recovery state, report required action, then resume only after health returns.
