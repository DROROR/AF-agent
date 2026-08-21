# Security Standard

Never commit API keys, worker tokens, DB passwords, Adobe credentials, SSH private keys or access tokens.

Use `.env` locally and commit `.env.example` only.

Worker accepts only predefined operation types. Never support arbitrary:
- shell commands
- PowerShell
- JSX supplied by API
- filesystem paths outside the work root
- executable paths from client input

Restrict job files to a configured work root such as `C:\DYO-Agent\`.
Normalize/validate paths and reject traversal.

Workers initiate outbound HTTPS/WebSocket connections. No inbound public Windows worker port is required.

Pin/lock dependencies and avoid unnecessary packages.
