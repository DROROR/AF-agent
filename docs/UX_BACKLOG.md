# Simple-mode UX backlog

Raised by Fahad on 2026-10-04 while walking a mockup template through Simple mode as a
non-technical client would: "the UX is still very complex, you cannot tell where to click
next". Each item is something seen on the live dashboard that day. Done items stay listed
with the commit, so the list is also the record.

## Done
- Plain wording on the Scenes tab, English and Hebrew (`b0d1ff6`).
- A numbered "what to do on this page" guide driven by the same state as the buttons;
  cards labelled "Scene N / The whole video"; parts with nothing to change folded away
  (`e5e181e`).
- One press to take the whole plan (`7fcbba1`); one screen to check every picture slot
  (`8089bb1`).
- "Leave it as the template has it" is a recorded decision; an undecided text asks a plain
  question (`9f8d71f`).
- Brand-rule refusals say what to do instead of naming an internal file (`31e4f03`).

## Open - in the order a client meets them
1. **After Approve Scenes the page stays on Scenes.** Nothing visibly happens; the client
   concluded the click had failed. Move to the Preview tab, or say "Approved" where they
   are looking.
2. **The brand rules are only discovered by a refusal.** The required line and the logo
   rule should be a step in the guide before Approve, with one press to put the line on a
   text layer.
3. **"Preview generating…" has no progress and no time estimate**, and every decision on a
   scene re-renders its preview before Approve unlocks. Show a loader with elapsed time;
   do not re-render for a decision that changes nothing on screen.
4. **Raw template names everywhere** - `!MAIN`, `Transition_scene_01`, `White Solid 2`,
   `Screen_holder_06 › White Solid 2`. The plain label is above the card now; the storyboard
   strip, the picture-check captions and the edit drawer still show the template's names.
5. **The edit drawer** is long and technical: slot verdict percentages, layer paths in
   capitals, timestamps and durations a client never needs.
6. **Preview tab errors are raw worker messages** ("operation 0 (SET_BRAND_COLOR) failed:
   …") with a "Continue execution" button that repeats the same failure. Say which thing
   failed in the client's terms and what to change.
7. **Empty and loading states**: cards with no preview, an empty storyboard tile, the
   Jobs page failing whole when one row is unreadable.
8. **Colours**: the drawer shows a colour picker with a value for a layer nobody chose a
   colour for; confirm it never saves that value unasked. Offer the client's website
   colours as suggestions (read from the site's CSS, never guessed by the assistant).
9. **Two "what to do" banners** on one page (the blue one above the tabs and the guide)
   can disagree in wording; keep one voice.
10. **New project**: the path field needs a typed Windows path; the inspection result is a
    table of counts with no sentence saying "this template is ready".
