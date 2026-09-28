# DYO Video Agent — step by step

From buying a template to downloading the finished videos. Follow in order.

---

## Part 1 — Get the template (on the Windows computer)

**1. Buy and download from Envato**

Go to elements.envato.com or videohive.net. Search for an After Effects template.

Before you download, check the template page:

- **"Plugins Required: No"** — take only these. A template needing Element 3D, Optical Flares, Trapcode or similar will not render unless that plugin is licensed and installed.
- **After Effects CC 2020 or newer.**
- **Note the fonts it lists.** You need them installed before you render.

Download the **After Effects** version, not the Premiere one. You get a `.zip`.

**2. Unzip it**

Unzip anywhere. Inside you normally get:

```
Project.aep          <- the template
Footage/             <- images and video it uses
Fonts/  or Help/     <- font names or links
```

**3. Install the fonts**

Open the fonts the template lists, click **Install** on each.

> A missing font is silently replaced by After Effects. The render succeeds and looks wrong. Nobody catches this for you.

**4. Put a COPY in the work folder**

Create this folder once:

```
C:\DYO-Agent\copies\
```

Copy the **whole unzipped template folder** into it — the `.aep` **and** its `Footage` folder together, keeping the same structure:

```
C:\DYO-Agent\copies\restaurant-promo\Project.aep
C:\DYO-Agent\copies\restaurant-promo\Footage\...
```

Two rules:

- **A copy, never the original download.** Keep the original untouched somewhere else.
- **Keep the `.aep` and its `Footage` folder together.** Separate them and After Effects loses every linked file.

**5. Open it once in After Effects, then close it**

Double-click the `.aep`.

If a dialog says *"This project must be converted from version …"* — click **OK**, then **File → Save As** and save it with a new name in the same folder, for example `Project (converted).aep`. Use **that** file from here on.

Close After Effects afterwards.

> Skip this and the very first inspection fails with a conversion error.

---

## Part 2 — Prepare your content

Gather on any computer — these get uploaded through the browser, so a Mac is fine:

- Client images / screenshots
- Client logo (PNG with transparent background is best)
- Any video clips
- The texts you want, written out

---

## Part 3 — Before every session

On the **Windows** computer:

1. Open After Effects.
2. Close any project — leave it **empty**, no dialog on screen.
3. Leave it open.

Then check the dashboard's **Workers** page: your worker must show **After Effects: ONLINE**.

> If a "Save changes?" dialog is waiting, everything stops. The system will never click it for you.

---

## Part 4 — Build the video (in the browser)

Open **https://ae-agent.dyocourses.com** and log in.

**Step 1 — New project**

**Projects → New Project**. Fill in:

| Field | What to put |
|---|---|
| Worker | Your Windows computer |
| Template ID | Any short name, e.g. `restaurant-promo-v1` |
| Source project path | The **full path** to the copy, ending in `.aep` |

Path example:

```
C:\DYO-Agent\copies\restaurant-promo\Project (converted).aep
```

Press **Inspect Template**. It opens the file on the Windows machine and reads it. Large templates take several minutes.

Read the result. **Missing footage** or **Plugin references** listed here means trouble later — go back and fix it now.

Then press **Create Project**.

**Step 2 — Upload your files**

**Files** tab → choose a file → **Upload**. Repeat for each.

For the logo, set **Type override → Logo**. Give each file a clear Label.

**Step 3 — Match your content**

**Scenes** tab. Each scene shows its slots.

Assign your uploaded file or your text to each slot.

Some slots will be **blocked** and demand you look at a real frame first. Press the capture button, look at the picture, then decide. This is deliberate — it happens where the system is not confident, and it will not guess for you.

**Step 4 — Set the vertical layout — do this NOW**

> **Order matters here.** Do this **before** you approve the plan. Setting it afterwards rewrites the plan and wipes out your approvals and your preview work.

Skip this step entirely if you only want a landscape video.

Switch **Simple → Advanced**, open **Render Settings → Reels layout**:

1. Pick the scene.
2. Press **Read layers**.
3. The fields arrive **already filled in**, measured from the scene itself. Backgrounds are enlarged to cover the tall frame; everything else keeps its real size.
4. Change anything you disagree with.
5. **Save this Reels layout.**

Read the **"Layers this cannot help with"** list. Those layers keep their template position while the frame gets narrower, so some can end up partly outside the vertical frame. You will see it in the preview later.

**Step 5 — Approve the plan**

Back on **Scenes**, press **Approve Scenes**.

**Step 6 — First preview**

**Preview** tab → **Start execution**.

After Effects builds **one frame**. Look at it properly — fonts, images, colours.

- Looks right → **Approve**
- Looks wrong → **Reject**, fix it on Scenes, run again

**Step 7 — Pick the output compositions**

**Export** tab. If it asks, choose which composition becomes the **landscape master** (and the vertical one).

**Step 8 — Complete preview**

**Preview** tab → generate the full preview. Watch the whole thing.

This is where you check the vertical version really works. Approve it.

**Step 9 — Render and download**

**Export** tab → **Render**.

This is the slow part — real After Effects rendering, minutes to an hour depending on length.

When it finishes, **download** buttons appear for both the landscape and vertical videos.

---

## If something stops you

**A greyed-out button** always says underneath why, and what unlocks it. Read that line.

**"This scene was not measured"** on the Reels layout → the Windows computer is running an older worker. Install the latest update.

**A job fails mentioning an older worker version** → same thing. Install the update.

**After Effects errors** → close After Effects completely, reopen it empty, try again. This fixes most of them.

**Anything else** → tell DYO exactly what the screen said. The wording is specific on purpose.

Nothing is ever lost. The original template is never modified, and an interrupted job is reported rather than left hanging.

---

## What it cannot do yet

- **Your own music.** A template's own audio renders fine; supplying your own soundtrack is not built yet.
- **Move animated layers for vertical.** A layer with its own animation is left where the designer put it rather than having that animation destroyed. The screen names those layers.
