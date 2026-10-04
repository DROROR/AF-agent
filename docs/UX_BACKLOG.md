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
- **After Approve Scenes the page moves to the Preview tab** (Simple mode, on success only;
  a refusal stays on Scenes with its reason) (uncommitted, 2026-10-04).
- **Preview tab, Simple mode, rebuilt as two steps with one question each** (uncommitted,
  2026-10-04):
  - Step 1 shows the first frame large and asks "Does this frame look right?" with yes / no.
    Yes is the approval click and then starts the full video by itself.
  - The full video is not offered at all before the first frame is approved.
  - "Preview at (seconds)", "Regenerate First Preview" and "Analyze Preview Timing" sit
    behind a closed "Look at a different moment" disclosure.
  - The engineering progress count, the "ready to render" status line and the "Started"
    hint are gone from Simple (all still in Advanced).
- **Making the full video says it is being made** (uncommitted, 2026-10-04): the button is
  replaced by "Your video is being made… 2:15" from the press until the video is there; the
  page watches the job and shows the video by itself; a reload finds the running job in the
  job history; the server's "already has a live CREATE_PREVIEW job" is read as "already being
  made", never shown as an error.
- **The Landscape output is never a trip to another tab** (uncommitted, 2026-10-04): Simple
  mode takes the server's suggestion (the template's only master composition + the names
  another project on the same editing computer is set up with), says so in one line, and
  saves it when "Make my full video" is pressed. With no suggestion the same setup form is
  shown in place.
- **Failures say what failed, truthfully** (uncommitted, 2026-10-04): "The video could not
  be built" / "The full video could not be made" / "The Landscape video could not be
  rendered", one plain sentence, the worker's own message word for word behind a closed
  "Technical details", and a "Try again" button. "Could not dispatch this job" is no longer
  said about a job that was dispatched fine. (Was Open item 6.)
- **The blue banner follows the real state** (uncommitted, 2026-10-04): start -> being built
  -> check the first frame -> make the full video -> being made -> watch and approve ->
  Export. The Preview and Export tabs tell it when the facts change, and it re-reads by
  itself every 5 seconds while something is running, on whichever tab is open.
- **One shared "this is running" notice with a clock** (`BusyNotice`) and one shared plain
  failure notice (`ProblemNotice`) (uncommitted, 2026-10-04), used for: building the video,
  making the full video, rendering (Export - which used to say "Started" and then never look
  at the job again), each scene preview ("After Effects is making this preview… 0:23" /
  "Waiting its turn"), "Updating previews… 3 of 8 ready" beside Approve Scenes, the picture
  check ("… 3 of 14 - Now: Picture in Scene 2"), a file upload, and the new-project template
  inspection. (Was Open item 3, first half.)
- **Jobs page: one unreadable row no longer blanks the page** - the rest are listed and the
  page says how many are not shown (uncommitted, 2026-10-04). (Part of Open item 7.)
- **Plain names instead of the template's** on the storyboard strip and the picture-check
  captions ("Scene 3", "Picture 2 in Scene 3"); the template's own name stays on hover
  (uncommitted, 2026-10-04). (Part of Open item 4.)
- **One voice, one primary button on Scenes** (uncommitted, 2026-10-04): the banner's
  "Review each scene" now hands the order to the numbered guide instead of giving its own,
  different instruction; and only the button of the step the guide marks "now" is drawn
  primary. (Part of Open item 9.)
- **Export tab, Simple mode** (uncommitted, 2026-10-04):
  - Pressing Render replaces the button with "Your final Landscape video is being made…
    mm:ss" and says it can take 30 to 40 minutes; it cannot be pressed twice; a reload finds
    the running render again. (It used to say "Started" and never look at the job again - a
    render that failed 20 seconds later went on reading "Started".)
  - A failed render says "Your final Landscape video could not be made", one plain
    sentence, the raw reason behind "Technical details", and "Try again".
  - The finished videos sit directly under the Landscape card and turn into the download
    when the render ends, without a reload.
  - The Reels card and its setup form wait behind a closed "Also make a tall version for
    phones" unless a tall version is already set up. Advanced view is unchanged.
- **Approving the full video unlocks Export at once** (uncommitted, 2026-10-04): the lock
  comes off the tab and the banner moves on without a reload, and in Simple mode the page
  moves to Export - as Approve Scenes moves to Preview.
- Empty states that pointed at a button that does not exist ("Click Preview Scene") or at
  nothing ("renders will appear here") now say what really happens and what to press
  (uncommitted, 2026-10-04).

## Open - in the order a client meets them
1. **The brand rules are only discovered by a refusal.** The required line and the logo
   rule should be a step in the guide before Approve, with one press to put the line on a
   text layer.
2. **Every decision on a scene re-renders its preview before Approve unlocks.** The wait now
   shows a count and a clock, but the re-render itself still happens for decisions that
   change nothing on screen. Not done: it needs a rule for "this edit cannot change the
   frame", which is a behaviour change to the preview queue, not a display one.
3. **Raw template names in the edit drawer and on the cards' own titles.** The storyboard
   and picture captions are plain now; the card heading under "Scene N" and the whole edit
   drawer still show the template's composition and layer names. Not done: the drawer is
   used in Advanced too and has no plain label for a layer to fall back on.
4. **The edit drawer** is long and technical: slot verdict percentages, layer paths in
   capitals, timestamps and durations a client never needs. Not touched.
5. **After "yes" on the first frame with SEVERAL scenes**, the remaining scenes are still
   built one press at a time ("Build the rest of the video"), and only then does the full
   video start. With one scene it is a single press. Not done: chaining dispatches needs a
   live check of how soon the editing computer accepts the next job.
6. **A file upload shows elapsed time, not a percentage.** The upload goes through `fetch`,
   which reports no progress; a real bar needs the upload rewritten on XMLHttpRequest.
7. **Export, once the tall version is opened or set up, shows two primary buttons**
   (Render Landscape, Render Reels). Left: each is "the" action of its own card.
8. **Empty and loading states still to walk**: an empty storyboard tile, the Project front
   page and Files list while loading (a bare shimmer with no words).
9. **Colours**: the drawer shows a colour picker with a value for a layer nobody chose a
   colour for; confirm it never saves that value unasked. Offer the client's website
   colours as suggestions (read from the site's CSS, never guessed by the assistant).
10. **The Scenes guide and the banner are still two elements.** They no longer contradict
    each other, but the page carries both; merging them is a layout change.
11. **New project**: the path field needs a typed Windows path; the inspection result is a
    table of counts with no sentence saying "this template is ready".
12. **A job whose status response cannot be read is waited on forever** by the pages that
    poll a single job (they treat an unreadable answer as "not finished yet"). Seen while
    writing tests, not live. Needs a bound and a plain message.
13. **Someone else's complete preview**: if a different user started it, this user's tab
    shows "being made" (from the server's refusal) but the banner cannot see that job and
    keeps saying "Make the full video" until the video lands.

## 2026-10-04 (later) - added
- **Done:** "Is the picture the wrong way round in the video?" in the edit drawer (flip left
  to right, turn a quarter / upside down), shown once a picture is chosen.
- **Open:** that control lives in the edit drawer only; a client who sees a mirrored picture
  in the preview has no pointer from the Preview tab to it. The "No, something is wrong"
  answer on the first frame should offer it by name.

## 2026-10-04 (evening) - audit of the live dashboard, signed in as the test user
Seen on real screens of project `5db054f5` in Simple view, not inferred from code.

**Fixed in this pass**
- Edit drawer in Simple view: titled "Change this scene"; pictures first, then texts, each
  under a plain name ("Picture 2", "Text 1") with the template's layer name on hover; the
  composition paths in capitals, "Final duration", "Instructions / notes" and the asset
  timestamp are Advanced-only; colours sit under one closed "Colours (optional)" line; a
  picture place already confirmed no longer shows its structural verdict (an unconfirmed or
  stale one still does - a gate is never hidden). One scene's drawer was 5,700 px tall.
- Scene cards: the plain name ("Scene 3", "The whole video") is the title; the template's
  name is on hover. The card button reads "Change picture or text" and looks like a button.
- Storyboard: a part with no card and no picture is no longer an empty tile under a raw name.
- Export, once the video is made: no intro card, "Your video is ready" above a secondary
  "Make it again" (it was a primary "Render Landscape" that restarts the render).
- Preview, once approved: one "Go to Export" button instead of three buttons, two disabled.
- "Everything is done" banner and checklist row now link to Export.
- Files tab wording: "Your files", "Add a file", "What is this file?", "No files yet".

**Still open from the same audit**
- New project, second step: "Template ID", "Source project path (on the Worker machine)",
  "ae-mcp bridge"; a typed Windows path; a table of counts as the result.
- The sidebar shows Jobs / Queue, Workers, Approvals, Renders, Activity / Logs in Simple view.
- "Delete Project" is a large red button at the top of every tab.
- Files: a SHA-256 on every file; one file per upload.
- Project checklist names ("Review AI Plan", "Match Your Content") do not match the tab names.
- "No, something is wrong" on the first frame does not lead to the picture that is wrong.
- The Hebrew for everything added today is unreviewed.
