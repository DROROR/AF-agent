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

**Fixed in a second pass the same evening**
- New project, second step, in plain words: "Editing computer", "A short name for this
  template", "Where the template file is on the editing computer", "Connection to After
  Effects", "Read the template".
- Project checklist steps say what to do: Add your files / Make the AI plan / Read the AI plan /
  Check the scenes / Check one frame / Watch the full video / Download the video.
- Files: the SHA-256 line is Advanced-only.
- A first frame that was not approved now says where a mirrored or sideways picture is fixed.

**Deliberately not changed**
- "Delete Project" stays at the top: the operator asked for that twice (see the comment in
  ProjectWorkspaceShell.tsx).
- The sidebar still lists Jobs / Workers / Approvals / Renders / Activity for everyone: it is
  the operator's own navigation, and hiding it is their decision to make.
- The Hebrew step names and wizard labels were left as they were; only English was reworded.

## 2026-10-06 - asked for by the client while making his first video
- **Done:** "Set colours once for the whole video" on the Scenes tab. Each colour layer that
  repeats across scenes is listed once, by the layer's own name, with how many places it is
  in; one choice is written to all of them (the same SET/CLEAR_BRAND_COLOR a scene's drawer
  sends, under the same rule for which colours can be set). Not drawn when nothing repeats.
- **Open:** the rows carry the template's own layer names ("Text A", "DOTS"); the client's
  words were "header, subtitle, text, background". Nothing in a template says which layer is
  which of those, so a plain name would be a guess - a person would have to name them once.
- **Open:** not yet seen on the live dashboard or tried on a real plan.

## 2026-10-06 - "still complex, and the colours are hidden" (client, relayed by the operator)
Seen in a local preview against live data before committing.
- Scenes page order: what to do first, then colours, then the cards. The thumbnail strip is
  gone - each card shows the same frame at full width.
- "Colours for the whole video" is an open card of round swatches (it was a collapsed line):
  click a swatch, press "Apply to the whole video".
- Scene card: one real frame ("The template, before your changes"), then PICTURE with a
  thumbnail of the chosen file, TEXT, and one button. The second, made-up "rough sketch"
  picture with its orange note is removed.
- A place every scene shares (a background picture) is on "The whole video" card.
- **Open:** the swatch names are still the template's ("Text A", "DOTS"); "Claude - Generate
  suggestions" stays the loudest button after its step is done; nothing here has been tried
  by the client yet.

## 2026-10-06 - "all those were good, and suddenly they need attention" (client)
Checked against all 24 revisions of his plan: nothing he set was lost. Five headline texts
were never filled; their cards said "Ready" until 636a404 made the badge speak for its own
card. The operator's own test of this template never met this because every text was filled.
- **Open:** the card names the open text "Text A"; the panel calls the same box "Text 3".
  Nothing connects the two.
- **Open:** in the panel the undecided box is not marked, and the template's word shown grey
  inside it ("APP") reads as if it were already filled.
- **Open:** "Keep the template's text" does not say what that text is. Here it is the
  template's English headline, which a client would not want in a Hebrew video.
- **Open:** the headline is the last text box in the panel, after the smaller lines.
- **Open:** no way to say "no text here" (SET_TEXT needs at least one character; no hide
  control in the web app). Needs a worker change and a run on After Effects.
- **Open:** "Leave empty to clear the current text" under every box does not say what the
  video will then show.
- **Open:** a badge that turns from "Ready" to "Needs your choice" after an update gives no
  reason; the client read it as his work being undone.

**Done the same day (web only), seen in a local preview against the client's own plan:**
- The card shows an open text by the words the video would carry ("APP"), with "Write my own
  text" that opens the panel on that very box, and a quieter "Keep "APP"".
- In the panel an unfilled text box is marked "Not filled in yet"; the line under every text
  box says which template words it replaces. The grey word inside an empty box is gone.
- Still open from the list above: the order of the text boxes, "no text here", and a reason
  when a badge changes after an update.

## 2026-10-06 - "the option to choose not to put text" (client)
- **Done in code, not yet run on After Effects:** "No text here" on a scene card's open text
  and "No text in this place" under every text box in the panel. Recorded on the plan as its
  own decision (NO_TEXT) in the reviewer's name; the scene counts as settled; the worker is
  sent an empty text for that layer and runs no fitting on it. Needs a worker newer than
  cbd43c6 - an older one refuses the empty text and the job fails.
- **Open:** texts in the panel are still listed smallest first; the client asked for header,
  second heading, small text. The template reading records no text size to order them by.

## 2026-10-06 - "it should present the new screenshot, or just the image itself" (client)
The step "Check where 1 picture will appear" shows the template's untouched frame, without
the client's picture in it, and asks whether the picture is in the right place. Nothing on
screen can answer that. "Why am I asked?" shows the checker's own sentence ("a full-bleed
image ... mapped into a decorative card"). **Open.**

## 2026-10-06 - "Approve Scenes" refused after every step said Done (client)
All four steps of the Scenes guide were ticked; pressing Approve returned both brand rules
at once in one red paragraph: no logo, and no "by DYO App" line. His logo was in the video,
but the file had been uploaded as a picture, and only a file uploaded as a logo counts.
- **Done:** the two messages named a button that no longer exists ("Edit"); they now name
  "Change picture or text" and say the logo must be the file uploaded as the logo.
- **Open:** the two rules should be a step of the guide, checked before Approve is offered,
  each with a button that opens the place to fix it.
- **Open:** nothing tells a client that a logo uploaded in the picture box does not count,
  and a file's kind cannot be changed after upload.
- **Open:** two refusals arrive as one run-on paragraph.

**Done 2026-10-07, seen in a local preview on the client's plan (the server's list simulated
in the browser; not yet seen against the deployed API):** the plan response now carries what
the approval gate would refuse (`brandNeeds`), the Scenes guide has a step for it before
"Approve", and a card under the guide settles each one: "This is my logo" on a picture
already in the video, and "Add the line to this text" with the exact line from the server.
Marking a picture as the logo also makes it fit whole inside its place, as any logo does.

**Seen live the same day (b982d09), on the client's plan:** the step and the card appear
with the deployed API. One press of "This is my logo" on a picture that had already been
confirmed in its place re-opened "Check where your pictures go" for that picture - a logo
fits whole inside its place, so the earlier confirmation no longer describes it. Honest,
but it reads as the guide going backwards; the card now says so before the press.
- **Open:** there is no "undo" for "This is my logo". The operator pressed it by mistake on
  the client's plan and it had to be reverted with a plan edit.

## 2026-10-07 - audit of every tab before a new template test (operator asked for "best, simple, nothing removed")
Read against NN/g's heuristics (status always visible, one step at a time, errors next to
their cause with the fix in them, a disabled control says why), Canva (preview beside the
edit) and Plainly (human display names per layer). Seen on the test project in a local
preview; nothing removed, every control still there.
- **Done - Files:** each file says what the system takes it for ("Your logo" / "Picture - goes
  into a picture place"), and a still image can be declared the logo or back ("This is my
  logo"), the one change of kind allowed after upload. The upload hint says why a logo must
  be uploaded as one.
- **Done - AI Plan:** cards and rows carry the names the Scenes tab uses ("The whole video",
  "Scene 3", "Text 1", "Picture"), in the same order; the template's names stay on hover.
  The bottom button says where it goes ("Go to the Scenes tab").
- **Done - Projects list:** "Still to decide" instead of "Unresolved"; the file fingerprint
  is drawn only for someone in Advanced view.
- **Done - Overview:** plain words ("Is everything running right now?", "Connected to After
  Effects"); the queue note no longer points at a design document.
- **Done - Scenes:** "Claude - Generate suggestions" steps back once its step is done; the
  colours "Apply" button says it waits for a colour to be clicked.
- **Done - picture check:** the client's chosen file is shown beside each spot, and the
  caption says which file goes into the phone shown; the hint names the real button.
- **Open:** the picture check still shows the template's own frame, not one with the
  client's picture in it - that needs the frame rendered after the picture is placed.
- **Open:** text boxes are listed smallest first (needs text size from the template reading).
- **Open:** "This is my logo" in the brand box has no undo.

## 2026-10-07 - Scenes tab, "why is it still complex" (operator)
Seen in a local preview on both projects. What was on screen before the first card: a
"What to do next" banner, a "What to do on this page" list of five full sentences, an
orange Claude button, "Approve Scenes", eight colour chips each with a hex code and "Use
the template's colour", and under every one of nine frames "The template, before your
changes". Changed, nothing removed:
- One "what to do": the banner stands down on the Scenes tab in Simple view.
- The guide carries counts ("4 of 5 done", "9 scenes - 5 still need your choice"); a done
  step is one short line; only the step to do now has its words; the last step keeps its
  words once everything is done.
- The Claude button and "Use everything from my plan" show at their own step; afterwards
  they fold under "Ask Claude for suggestions again". Once approved, "Go to Preview"
  stands where "Approve Scenes" was, instead of a greyed button.
- Colour chips: swatch, name, count; "Your colour" and "Reset" only where a colour is
  chosen. The caption under every frame is said once above the cards.
- New project: Back on the first step leaves the wizard; a waiting Next says it needs a name.

## 2026-10-07 - one orientation section; Export says why it waits; colour tiles (operator)
- **Done:** in Simple view the seven steps of the video stand in one row at the top of every
  tab (done / now / not yet), with the step to do now and its button right under them - the
  old "What to do next" banner is merged into it, so one section says what is done, what is
  left and what comes next.
- **Done:** the Export tab, while locked, is one plain card ("Your video is not made yet",
  what comes first, "Go to Preview") instead of a setup form for a step not yet reached.
- **Done:** colours are tiles - a circle, the name, how many places; "Your colour" and
  "Reset" only where a colour is chosen.

## 2026-10-07 - "the flips do not work" / "why set what the template already had" (client, operator)
- The flips were saved (plan revisions 38 and 39, 13:34 and 13:41 UTC) but the frame on the
  Preview tab was made at 11:25 from revision 37; editing the scenes sends the plan back
  to Draft and nothing on the Preview tab said the frame was older than the scenes.
  **Done:** the first-frame card says "This frame is from before your last change" with
  the way to a new one (Approve Scenes, then Build my video); the flip hint in the panel
  names those buttons.
- **Done:** a colour on screen for less than a tenth of the video (the fade at the end) is
  folded under "N more colours, on screen only for a moment"; a tile says when such a
  colour shows.
- **Done:** a locked tab is no link while locked.
- **Open:** approving the scenes again and building the frame again after one flip is two
  presses on two tabs; one "Update my frame" would be better, but it is a server change.

## 2026-10-08 - the head of a project page was too tall
- Seen (operator, Dror's project): back link, name, facts line, the orientation section with an arrow and three stacked lines, then the tabs - the tabs sat below the fold on a laptop.
- Done: the back link shares the name's row; the orientation section is two lines (the steps, then "n of 7 done · step · what to do" with the button at its end), no arrow; the facts line pulls up; the tabs stay under the top bar while the page scrolls. Head height at 1440 px: ~400 → 294 px.

## 2026-10-08 - Scenes: the two controls sit at the end of the tab row; the tab row no longer scrolls
- Seen (operator): a whole card, with a fold, for one button; and the tabs "scrolling".
- Measured on the page: the tab row was 38 px tall with 74 px of content. The lock hint under a locked tab sat inside a row with `overflow-x: auto`, which makes the other axis scroll too, so the row moved up and down under the wheel.
- Done: the suggestions button and the step button are drawn into a slot at the end of the tab row (`useTabsEndSlot`); the card and the fold are gone; the row does not scroll on either axis and wraps on a narrow screen.

## 2026-10-09 - the slot gate's refusal was unreadable to the client (done)

On the QA project the operator pressed "Approve Scenes" with two pictures still waiting for their "show me the spot" confirmation. The button was enabled, and the refusal came back as one red paragraph of codes and layer names (`SLOT_CLASSIFICATION_UNCERTAIN`, `UNSAFE_FIT`, "Slideshow Main / Screen Shot 2020-12-30 at 12.17.08.jpg") that said nothing about where to go or what to press. His words: "where the error is, we cannot even mark it red; the client is not technical."

Done: the Simple view already knows which pictures the gate means (the same list its "check where your pictures will appear" box draws). "Approve Scenes" is now held while any of them waits, with the reason naming the button to press ("First confirm where 2 pictures will appear - press 'Show me all 2 spots' above"); the scenes holding those pictures are outlined in red with one line saying so; and if the server's refusal still arrives, it is said in the same words with the scenes named, the raw sentence kept behind "Technical details". English and Hebrew; the Hebrew names the same button the Hebrew page draws.

## 2026-10-09 - from the client's second-frame review (open)

- **One size for every header, one for every subheader.** Each template text keeps its own size and the fit shrinks each independently. The client expects headers to match across scenes. Needs a decision: a per-plan "header size" that overrides the template, or leave the template's typography.
- **Where is the background colour?** "Colours for the whole video" lists the colours inspection found; the client asks that the background and the background elements be named as such. Verify on his template which solids/controls those are, and label them.
- **Two-line text in the planner.** Works today by typing a line break in the text (reaches After Effects as a carriage return) and, since the box layout, by wrapping inside the template's width. The AI planner should be told the template's line count per text so it writes lines that fit.
