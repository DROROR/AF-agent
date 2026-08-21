# Start Here

1. Copy this documentation pack into the root of the existing repository.
2. Open Claude Code in that repository.
3. Tell Claude Code:

```text
Read CLAUDE.md and every file under docs/. Do not redesign the locked architecture. Start Phase 0 from docs/PHASES.md. First create the read-only Windows preflight tool and perform the repository/existing ae-mcp audit. Do not modify any .aep file or the existing ae-mcp installation. At the end of Phase 0, update docs/AUDIT.md, run tests, list every file changed, state blockers, and stop for my approval before Phase 1.
```

4. Review Claude's Phase 0 output.
5. If no hard blocker exists, approve Phase 1.
6. First live milestone is not video generation. It is:

```text
Worker 1: ONLINE
AE: ONLINE
MCP: ONLINE
Last heartbeat: fresh
maxConcurrency: 1
```

7. Only after that works, move to read-only template inspection and `template-manifest.json`.
