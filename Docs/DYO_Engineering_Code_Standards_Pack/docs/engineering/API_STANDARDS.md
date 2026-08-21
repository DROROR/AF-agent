# API Standards

Fastify routes should:
1. authenticate/authorize
2. validate input
3. call an application service
4. map result to HTTP response

Business logic does not live in route handlers.

Use consistent errors:
```json
{
  "error": {
    "code": "WORKER_OFFLINE",
    "message": "Selected worker is offline",
    "requestId": "..."
  }
}
```

Do not expose stack traces or raw DB/process errors.

Retried commands must be idempotent where practical:
- worker registration
- heartbeat
- job claim
- checkpoint update
- render completion callback

Dashboard users authenticate separately from workers.
Workers use unique scoped credentials/tokens.
