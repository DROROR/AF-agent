# Testing Strategy

## Unit tests
Cover pure rules:
- state transition validation
- worker compatibility
- scene ordering
- execution-plan validation
- branding rules
- path restrictions
- retry policy

## Integration tests
Cover:
- API + PostgreSQL
- repositories
- worker registration/heartbeat
- job claim/assignment
- migrations
- checkpoint/resume flows

## Contract tests
Server and Windows worker must agree on:
- message schemas
- job commands
- statuses
- error codes
- manifest/execution-plan versions

## AE acceptance tests
Run on a real Windows AE worker:
- inspect template
- copied project
- replace assets
- preview
- landscape
- native Reels
- recovery after interruption

Rules:
- Bug fixes get regression tests when practical.
- No test-order dependency.
- No flaky sleeps if conditions/polling can be used.
- Mock external process boundaries, not internal business logic.
