DYO Worker update - safe inspections, slot semantics and measured asset facts
Build 8f3568a104a6dfb5c14a0497710058249ea9256f

WHAT TO DO
  1. Unzip this folder anywhere (Downloads is fine).
  2. Double-click DYO-Worker-SlotSemantics-Update.bat.
  3. Read the last few lines it prints. Every line should start with [OK].

You will not be asked for a registration code, and you do not need to open
After Effects. Do not open, change or render any project while it runs.

WHAT THIS UPDATE CHANGES
  1. Inspections never open your real project any more. Anything that needs
     to open a project in After Effects now works on a throwaway copy, made
     next to the file it inspects so linked footage still resolves, and
     removed again afterwards. The original template and the working copy of
     your session are never opened.
  2. If After Effects is holding a project with unsaved changes, the worker
     stops and tells you, instead of touching it. It never answers a "Save
     changes?" prompt for you.
  3. Every image slot in a template is now classified from its structure -
     whether it is a phone screen or a flat card - and the plan cannot be
     approved while that verdict is uncertain. Layer names never decide it.
  4. Immediately before replacing an image, the worker re-checks that the
     layer is still exactly the one that was approved, and refuses if the
     template has changed since.
  5. Hebrew text is applied with the correct paragraph direction and then
     read back and verified character by character.

WHAT IS PRESERVED
  - This computer's worker identity. The installer never reads, writes or
    re-registers WORKER_ID or WORKER_TOKEN; it only checks the credentials
    file exists, and stops if it does not.
  - .env (DYO_API_URL, AE_PATH, AE_MCP_PATH, AERENDER_PATH, WORK_ROOT) is
    excluded from the copy and never rewritten.
  - The Scheduled Task is restarted, never re-registered.
  - ae-mcp, its panel and its settings are never touched.
  - Job history lives on the server and is unaffected.

SAFETY
  - The worker is fully stopped, and its exit positively verified, before any
    program file is replaced. If it cannot be stopped, the installer aborts
    having changed nothing and restarts the existing worker.
  - The current program files and BUILD_INFO.json are backed up together
    before replacement (C:\DYO-Agent\app\dist.backup-<timestamp>).
  - After copying, the installer proves the new files physically landed and
    that exactly one healthy worker process tree came back. If either check
    fails, it restores the backup and restarts the worker automatically.
  - No After Effects project is opened, inspected, changed or rendered by
    this update itself.

IF SOMETHING LOOKS WRONG
  Send the last 20 lines the window printed, plus
  C:\DYO-Agent\app\logs\worker.log, to DYO. The rollback has already
  restored the previous working version if the update did not come up.
