# MVP Acceptance Criteria

MVP is accepted only when all items below pass.

## Three-template validation
Run the complete workflow on three different plugin-free templates.

## Source safety
- original `.aep` hash unchanged,
- source media not modified.

## Mapping/execution
- only selected scenes included,
- final order matches approved plan,
- separate placeholders map to correct assets,
- text/No Text respected,
- final duration respected,
- exact video timestamp within one source frame.

## Visual proof
- actual preview images captured from exact output comp,
- first-frame approval flow works,
- branding approval flow works,
- final preview approval works.

## Branding
- client/company logo at least once,
- Hebrew `מבית DYO App` present,
- official DYO blue used from approved config,
- client screenshots/logos/phone hardware not unintentionally recolored.

## Outputs
- landscape output correct,
- native 1080x1920 Reels correct,
- Reels layout is repositioned, not merely cropped.

## Reliability
- worker heartbeat visible,
- MCP disconnect detected,
- AE heartbeat/modal problem produces safe pause,
- at least one interrupted job resumes successfully,
- render is separate and recoverable.

## Corrections
One creative/design correction round is included in the workflow. Technical bugs are fixed until these acceptance criteria pass and do not consume the creative correction round.
