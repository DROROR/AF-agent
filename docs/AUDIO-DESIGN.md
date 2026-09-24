# Audio: what is missing, and the generic way to add it

Status: DESIGN ONLY. Nothing here is implemented.

## What exists today

Nothing that reaches a video. Concretely:

- `mime-allowlist.ts` accepts `audio/mpeg` and `audio/wav` and labels them `mediaKind: "AUDIO"`, so an mp3 or wav can be uploaded to a project's asset catalogue.
- Nothing ever consumes such an asset. `PLACEHOLDER_TYPES` (`template-manifest.ts`) is `image | video | text | logo | phone_screen | color | unknown` — there is no `audio`, so inspection never discovers an audio layer as an editable placeholder, no mapping can target one, and no execution operation can change one.

An uploaded audio file is therefore inert. It is stored and forgotten.

## What already works without any new code

A template's OWN audio already renders. `aerender` decides the output's audio from the named Output Module template (`-OMtemplate`), whose Audio Output setting includes audio whenever the composition has any. So a template that ships with music produces a video with that music today, with nothing to build.

What is impossible today is the client supplying THEIR music or voiceover.

## The design that fits this architecture

Treat audio exactly like every other replaceable element: as a placeholder discovered in the template, mapped by a human, and swapped by a deterministic operation. Not as a new parallel subsystem.

1. **Vocabulary.** Add `audio` to `PLACEHOLDER_TYPES`. It is deliberately NOT added to `SLOT_PLACEHOLDER_TYPES` (`slot-readiness.ts`) — slot semantics classify a VISUAL slot as a device screen or a flat card, and that question is meaningless for a sound. Audio placeholders are never structurally classified and never need an evidence frame, for the same reason text and colour placeholders do not.

2. **Discovery.** `classify-placeholder.ts` classifies a layer whose footage has an audio track and no video component as `audio`. The fact is already read during the project scan (`hasAudio` on the footage source) — the classifier simply never looks at it. Discovery must stay structural: a layer is audio because its source carries sound, never because of its name.

3. **Mapping.** An `audio` placeholder accepts an asset whose `mediaKind` is `AUDIO`. The compatibility rules are their own small set and must not reuse the visual ones: duration versus the composition's own duration (shorter audio leaves silence, longer is cut off — both worth reporting), and sample rate/channels as evidence. Dimensions, transparency, coverage and fit have no meaning here and must not be computed or displayed.

4. **Execution.** `MAP_FOOTAGE` already replaces a layer's source with an imported file and is source-type agnostic at the AE level (`layer.replaceSource`). Verify it against a real audio layer rather than assuming; if a separate operation is needed, it follows the same fixed-script, allowlisted pattern and the same fingerprint re-check as every other mutation.

5. **Rendering.** Nothing changes. The Output Module template already governs audio.

## What this deliberately does NOT do

**It cannot add music to a template that has no audio layer.** This design replaces the source of a layer the template already provides. Creating a new audio layer, choosing where it sits, how long it runs and how it fades is authoring, not templating — and the system's whole contract is that it fills in a designer's template rather than inventing structure. That is a separate feature with its own approval gate, and it should not be smuggled in here.

State this limitation to the client before promising audio: **if their chosen template has no music layer, they cannot supply music through this system as designed.** Choosing templates that include an audio layer is the cheaper answer.

## Priority

Audio is not part of the MVP acceptance list in CLAUDE.md. The outstanding MVP items are three plugin-free templates end to end, native 1080x1920 Reels output, timestamp accuracy within one source frame, and one interrupted-job recovery test. Audio should be scheduled after those unless the client says otherwise.
