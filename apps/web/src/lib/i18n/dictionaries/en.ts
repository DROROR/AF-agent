/**
 * The canonical English dictionary - also the TYPE authority. `he.ts` is
 * statically checked against `Dictionary` (index.ts's `Widen<typeof en>`),
 * so a missing/mistyped Hebrew key is a compile error, not a silent
 * runtime gap. `en` itself keeps `as const` (harmless internally); the
 * `Widen<>` type transform in index.ts turns its literal string types into
 * plain `string` for the shared `Dictionary` type, so he.ts can supply
 * different literal values while still satisfying the same shape.
 *
 * Do NOT put worker IDs, job IDs, file paths, API paths, AE version
 * strings, technical capability names (CHECK_HEALTH, INSPECT_TEMPLATE,
 * ...), filenames, or raw error/log payloads in here - those are never
 * translated (see CLAUDE.md / the i18n task). Everything else the user
 * reads on screen belongs here, not hardcoded in a component.
 */
export const en = {
  common: {
    language: "Language",
    back: "Back",
    next: "Next",
    yes: "Yes",
    no: "No",
    never: "never",
    close: "Close",
    unavailableFallback: "Could not load dashboard data.",
    staleNotice: (error: string): string => `Live updates paused - showing last known data, retrying… (${error})`,
    switchToTheme: (themeName: string): string => `Switch to ${themeName} theme`
  },
  nav: {
    overview: "Overview",
    projects: "Projects",
    jobs: "Jobs / Queue",
    workers: "Workers",
    approvals: "Approvals",
    renders: "Renders",
    activity: "Activity / Logs",
    settings: "Settings"
  },
  sidebar: {
    brandName: "AE Dyo Agent",
    primaryNavLabel: "Primary",
    brandLinkLabel: "DYO Dashboard - Overview",
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
    collapse: "Collapse",
    closeNavigation: "Close navigation"
  },
  topbar: {
    openNavigation: "Open navigation",
    fallbackTitle: "DYO Dashboard",
    logout: "Log out",
    systemNormal: "All systems normal",
    systemIssue: "System issue",
    checking: "Checking…"
  },
  status: {
    ONLINE: "Online",
    OK: "OK",
    OFFLINE: "Offline",
    ERROR: "Error",
    UNKNOWN: "Unknown",
    UNAVAILABLE: "Unavailable"
  },
  auth: {
    login: {
      title: "Sign in",
      subtitle: "Sign in to the DYO operations dashboard.",
      noAccount: "No account yet?",
      createOne: "Create one",
      emailLabel: "Email",
      passwordLabel: "Password",
      rememberMe: "Remember me",
      forgotPassword: "Forgot password?",
      forgotPasswordTitle: "Password reset is not implemented yet",
      submit: "Sign in",
      submitting: "Signing in…"
    },
    signup: {
      title: "Create account",
      subtitle: "Set up access to the DYO operations dashboard.",
      haveAccount: "Already have an account?",
      signIn: "Sign in",
      nameLabel: "Name",
      emailLabel: "Email",
      passwordLabel: "Password",
      passwordHint: "At least 8 characters",
      confirmPasswordLabel: "Confirm password",
      submit: "Create account",
      submitting: "Creating account…"
    },
    errors: {
      nameRequired: "Name is required",
      invalidEmail: "Enter a valid email address",
      passwordRequired: "Password is required",
      passwordTooShort: "Password must be at least 8 characters",
      passwordsDoNotMatch: "Passwords do not match",
      invalidValue: "This field is invalid",
      networkError: "Could not reach the server. Please try again.",
      invalidCredentials: "Invalid email or password",
      emailAlreadyExists: "An account with this email already exists",
      tooManyAttempts: "Too many attempts. Please wait a moment and try again.",
      signupDisabled: "Signup is temporarily disabled.",
      somethingWentWrong: "Something went wrong. Please try again."
    }
  },
  overview: {
    title: "Overview",
    description: "Live status of the DYO control plane.",
    loading: "Loading overview…",
    unavailableTitle: "Overview unavailable",
    api: "API",
    database: "Database",
    workersOnline: "Workers online",
    aeOnline: "After Effects online",
    mcpOnline: "MCP online",
    activeJobs: "Active jobs",
    lastHeartbeat: (relative: string): string => `Last heartbeat ${relative}`,
    noHeartbeat: "No heartbeat received yet",
    queueOverview: "Queue overview",
    queuePendingTitle: "Job queue history is not available yet",
    queuePendingDescription:
      "The API currently supports claiming and reporting individual jobs, but does not yet expose a queue listing endpoint. This section will show queued/running/completed job counts once that API exists (see docs/JOB-DISPATCH.md)."
  },
  projects: {
    title: "Projects",
    description: "Video production projects and their current stage.",
    newProject: "New project",
    emptyTitle: "No projects yet",
    emptyDescription: "Start a new project to begin the intake and template-inspection workflow.",
    unavailableTitle: "Projects unavailable",
    card: {
      sourceFile: "Source file",
      planStatus: "Plan status",
      revision: "Revision",
      sourceSha: "Source SHA",
      scenes: "Scenes",
      unresolved: "Unresolved",
      updated: "Updated",
      noPlanYet: "No plan yet",
      open: "Open"
    }
  },
  projectsNew: {
    title: "New project",
    description: "Create a project by inspecting a real, plugin-free After Effects template on a connected Worker.",
    stepperLabel: "Project setup steps",
    steps: {
      details: "Project details",
      template: "Inspect template"
    },
    fields: {
      projectName: "Project name",
      projectNamePlaceholder: "e.g. Cognetica - Spring launch"
    },
    template: {
      workerLabel: "Worker",
      workerPlaceholder: "Select a connected Worker...",
      noWorkersTitle: "No Worker reports the INSPECT_TEMPLATE capability",
      noWorkersDescription: "Register/update a Worker with this capability before creating a project - see Workers.",
      workerStatusLabel: "Worker status",
      aeStatusLabel: "After Effects",
      mcpStatusLabel: "ae-mcp bridge",
      templateIdLabel: "Template ID",
      templateIdPlaceholder: "e.g. white-app-promo-v1",
      sourceProjectPathLabel: "Source project path (on the Worker machine)",
      sourceProjectPathPlaceholder: "e.g. C:\\DYO-Agent\\copies\\template.aep",
      sourceProjectPathHint:
        "Must be the full file path to a COPY of the .aep, never the original file or a folder - the path must end in .aep.",
      inspectAction: "Inspect Template",
      inspecting: "Dispatching…",
      statusQueued: "Queued on the Worker - waiting for it to pick this up.",
      statusClaimed: "Claimed by the Worker - starting shortly.",
      statusRunning: "Inspecting the real template on the Worker now...",
      statusWaiting: "Waiting on a required action before this can continue.",
      inspectionFailedTitle: "Inspection failed",
      resultTitle: "Inspection result",
      resultCompositions: "Compositions",
      resultScenes: "Candidate scenes",
      resultPlaceholders: "Editable placeholders",
      resultNested: "Nested compositions",
      resultFonts: "Required fonts",
      resultFootage: "Footage referenced",
      resultMissingFootage: "Missing footage",
      resultPlugins: "Plugin references",
      resultUnknown: "Unresolved/degraded items",
      createProjectAction: "Create Project",
      creatingProject: "Creating…",
      createProjectFailedTitle: "Could not create the project",
      retryAction: "Inspect again",
      previousInspectionCancelled: "The previous inspection was cancelled before it ran. You can inspect again."
    },
    stepNotAvailableTitle: "Not available",
    stepNotAvailableDescription: "This step is not yet implemented."
  },
  jobs: {
    title: "Jobs / Queue",
    description: "Jobs currently claimed by a worker, plus your own full dispatch history.",
    unavailableTitle: "Jobs unavailable",
    currentlyActive: "Currently active",
    workerDataUnavailableTitle: "Worker data unavailable",
    workerDataUnavailableDescription: "Could not load worker records from the API.",
    emptyTitle: "No jobs currently claimed",
    emptyDescription: "Jobs a worker is actively running will appear here.",
    tableCaption: "Currently claimed jobs",
    jobIdColumn: "Job ID",
    workerColumn: "Worker",
    historyTitle: "Job history",
    historyDescription: "Every job you have dispatched, newest first - completed, failed, and in progress.",
    historyTableCaption: "Job dispatch history",
    historyLoading: "Loading job history…",
    historyUnavailableTitle: "Job history unavailable",
    historyEmptyTitle: "No jobs dispatched yet",
    historyEmptyDescription: "Jobs you dispatch from anywhere in the dashboard will appear here.",
    operationColumn: "Operation",
    statusColumn: "Status",
    projectColumn: "Project",
    sessionColumn: "Execution session",
    createdColumn: "Created",
    completedColumn: "Completed",
    reasonColumn: "Reason",
    noProject: "—",
    noSession: "—",
    noReason: "—"
  },
  workers: {
    title: "Workers",
    description: "Registered Windows workers and their real-time health.",
    unavailableTitle: "Workers unavailable",
    tableCaption: "Registered workers",
    nameColumn: "Name",
    statusColumn: "Status",
    aeStatusColumn: "AE status",
    mcpStatusColumn: "MCP status",
    aeVersionColumn: "AE version",
    maxConcurrencyColumn: "Max concurrency",
    currentJobColumn: "Current job",
    capabilitiesColumn: "Capabilities",
    lastHeartbeatColumn: "Last heartbeat",
    viewDetailsAriaLabel: (name: string): string => `View details for ${name}`,
    dataUnavailableTitle: "Worker data unavailable",
    dataUnavailableDescription: "Could not load worker records from the API.",
    emptyTitle: "No workers registered",
    emptyDescription: "Once a Windows worker pairs with the API, it will appear here."
  },
  workerDetail: {
    fallbackTitle: "Worker",
    workerId: "Worker ID",
    status: "Status",
    afterEffects: "After Effects",
    mcp: "ae-mcp bridge",
    aeVersion: "AE version",
    maxConcurrency: "Max concurrency",
    currentJob: "Current job",
    capabilities: "Capabilities",
    lastHeartbeat: "Last heartbeat",
    registered: "Registered",
    lastUpdated: "Last updated",
    offlineNotice: "Worker is offline — current status cannot be verified.",
    lastKnown: (label: string, relativeTime: string): string => `Last known: ${label} · ${relativeTime}`
  },
  approvals: {
    title: "Approvals",
    description: "Human approval gates required before DYO proceeds to the next production stage.",
    gates: {
      scenePlan: { title: "Scene plan approval", description: "Human maps/reorders/selects scenes and approves the execution plan." },
      firstFrame: { title: "First designed frame", description: "Real visual preview and style approval on the first executed scene." },
      branding: { title: "Branding, type & colors", description: "DYO/client brand rules, typography, and color approval." },
      fullPreview: { title: "Full preview", description: "Visual QA using actual previews from the exact output composition." },
      finalRender: { title: "Final render", description: "Final human approval before the recoverable aerender job is queued." }
    },
    pendingTitle: "Approval tracking is not backed by an API yet",
    pendingDescription:
      "Once a project can be dispatched for inspection and review, each gate above will show its real pending/approved/rejected state and reviewer here."
  },
  renders: {
    title: "Renders",
    description: "Real, persisted final render outputs (Landscape/Reels) for your projects.",
    projectSelectorLabel: "Project",
    noProjectsTitle: "No projects yet",
    noProjectsDescription: "Create a project to see its renders here once they exist.",
    loadErrorTitle: "Could not load renders for this project",
    emptyTitle: "No renders yet",
    emptyDescription: "Completed, validated renders for this project will appear here once produced.",
    variantColumn: "Variant",
    variantLabel: { LANDSCAPE: "Landscape", REELS: "Reels" },
    compositionColumn: "Composition",
    statusColumn: "Status",
    statusReady: "Ready",
    completedColumn: "Completed",
    sizeColumn: "Size",
    downloadAction: "Download",
    previewAction: "Preview",
    hidePreviewAction: "Hide preview",
    playerErrorTitle: "Could not play this video",
    playerErrorDescription: "The file could not be loaded. Try downloading it instead.",
    finalOutputsTitle: "Final Outputs",
    finalOutputsDescription: "Your finished, downloadable videos.",
    statusComplete: "Complete"
  },
  activity: {
    title: "Activity / Logs",
    description: "Audit trail of worker, job, and approval events.",
    pendingTitle: "Activity logging is not backed by an API yet",
    pendingDescription:
      "The API and worker both keep structured logs today, but there is no endpoint that exposes an events/audit feed to the dashboard. This page will show a live activity stream once that exists."
  },
  settings: {
    title: "Settings",
    description: "Dashboard preferences and account configuration.",
    navAiProviders: "AI Providers",
    navAppearance: "Appearance",
    navAccount: "Account",
    navIntegrations: "API / Integrations",
    appearance: "Appearance",
    themeLight: "Light",
    themeDark: "Dark",
    matchSystem: "Match system",
    savedOnThisDevice: "Saved on this device only.",
    language: "Language",
    account: "Account",
    accountNameLabel: "Name",
    accountEmailLabel: "Email",
    accountRoleLabel: "Role",
    logout: "Log out",
    apiConnection: "API connection",
    controlPlaneApi: "Control-plane API",
    controlPlaneApiValue: "Internal only (server-side proxy)",
    apiConnectionHint:
      "The browser never calls the control-plane API directly - all data on this dashboard is proxied server-side. There is nothing to configure here today.",
    aiProvider: {
      title: "AI Providers",
      description: "Bring your own AI provider key so the Mapping Assistant can generate real, evidence-backed suggestions. Keys are encrypted on the server and never sent back to this browser.",
      anthropicName: "Anthropic",
      anthropicModelsSummary: "Claude models",
      comingSoonName: (provider: string) => `${provider} (coming soon)`,
      badgeConnected: "Connected",
      badgeNotConnected: "Not connected",
      badgeError: "Error",
      selectedModelLabel: "Selected model",
      manageAction: "Manage",
      connectAction: "Connect",
      collapseAction: "Close",
      providerLabel: "Provider",
      providerValue: "Anthropic",
      apiKeyLabel: "API key",
      apiKeyPlaceholder: "sk-ant-...",
      modelLabel: "Model",
      statusLabel: "Connection status",
      statusConnected: (last4: string) => `Connected · Key ending in ${last4}`,
      lastVerifiedLabel: (date: string) => `Last verified ${date}`,
      testAction: "Test connection",
      testing: "Testing…",
      testSucceeded: "Connection succeeded.",
      saveAction: "Save & Connect",
      replaceAction: "Replace key",
      saving: "Connecting…",
      disconnectAction: "Disconnect",
      disconnecting: "Disconnecting…",
      loadFailedTitle: "Could not load AI provider status",
      connectionFailedTitle: "Connection failed",
      disconnectFailedTitle: "Could not disconnect provider"
    }
  },
  sceneTable: {
    emptyTitle: "No scenes to review yet",
    emptyDescription: "This table populates once a template has been inspected and its discovered scenes/placeholders are ready for approval.",
    tableCaption: "Scene and placeholder mapping table",
    useColumn: "Use",
    finalOrderColumn: "Final order",
    sourcePositionColumn: "Source position",
    sceneColumn: "Scene / Composition",
    mappingColumn: "Placeholder / Mapping",
    assetColumn: "Asset",
    textColumn: "Text",
    assetTimestampColumn: "Asset timestamp",
    finalDurationColumn: "Final duration",
    statusColumn: "Status",
    notesColumn: "Notes / Instructions",
    actionsColumn: "Actions",
    hasText: "Text set",
    noText: "No text",
    noAssetsUploaded: "No assets uploaded",
    noMappingDetected: "No placeholder detected for this scene yet",
    moveUp: "Move up",
    moveDown: "Move down",
    editRow: "Edit",
    includeSceneAriaLabel: (scene: string): string => `Include ${scene} in the final output`,
    placeholderType: {
      image: "Image",
      video: "Video",
      text: "Text",
      logo: "Logo",
      phone_screen: "Phone screen",
      color: "Color",
      unknown: "Unknown"
    }
  },
  planStatus: {
    DRAFT: "Draft",
    APPROVED: "Approved",
    REJECTED: "Rejected"
  },
  rowApprovalState: {
    UNREVIEWED: "Unreviewed",
    NEEDS_MAPPING: "Needs mapping",
    READY_FOR_APPROVAL: "Ready for approval",
    APPROVED: "Approved",
    REJECTED: "Rejected"
  },
  jobDispatch: {
    noWorkerTitle: "No worker available",
    noWorkerDescription: "Your editing computer isn't ready right now - it may be off, busy, or still updating. It will pick this up automatically once it's ready.",
    workerOfflineTitle: "Worker is offline",
    workerOfflineDescription: "Your editing computer is offline. Turn it on to continue.",
    dispatching: "Starting…",
    /** Simple-mode-only confirmation (ProjectPreviewTab/ProjectExportTab) - deliberately never includes the raw job id queuedDescription below shows; the client's own view already updates automatically once the real result is ready (the preview queue/session poll), so there is nothing for them to track by id. */
    startedHint: "Started - this will update automatically, no need to check again.",
    queuedTitle: "Job queued",
    queuedDescription: (jobId: string): string => `Job ${jobId} was queued for the worker. It will run once claimed - this page does not yet show live progress.`,
    failedTitle: "Could not dispatch this job",
    previewTimestampLabel: "Preview at (seconds)",
    invalidPreviewTimestamp: "Enter a valid, non-negative number of seconds",
    /** Preview Timing Analysis (live QA, 2026-09-09) - Simple Mode's own friendly analyzing state for ProjectPreviewTab's "Analyze Preview Timing" action; raw job/composition/layer ids never appear here (see projectWorkspace.overview.previewTiming below for the Advanced-only raw detail). */
    previewTimingAnalyzing: "Analyzing timing…"
  },
  projectWorkspace: {
    backToProjects: "Back to Projects",
    stepper: {
      ariaLabel: "Video production steps",
      stepOfTotal: (current: number, total: number, title: string): string => `Step ${current} of ${total} — ${title}`,
      status: { complete: "Complete", inProgress: "Current", locked: "Locked", ready: "Ready" },
      steps: {
        upload: { title: "Upload", description: "Your template and assets are uploaded and ready." },
        tellClaude: { title: "AI Plan", description: "AI is planning how to use your template and content." },
        reviewPlan: { title: "Review AI Plan", description: "Check the scenes, content, text and timing AI prepared for your video." },
        sceneMappings: { title: "Match Your Content", description: "Review each scene's suggested content, then approve the plan to continue." },
        firstPreview: { title: "First Preview", description: "Create a first designed frame and approve it before the rest of the video is built." },
        finalPreview: { title: "Final Preview", description: "Review the finished scenes - order, text, assets, timing and branding - before rendering." },
        render: { title: "Export Video", description: "Render the final Landscape and Reels videos and download them." }
      }
    },
    tabs: {
      overview: "Project",
      scenes: "Scenes",
      assets: "Files",
      preview: "Preview",
      export: "Export",
      workMap: "Work Map",
      revisions: "Revisions",
      renderSettings: "Render Settings"
    },
    tabLockedHint: {
      preview: "Locked until mappings are approved",
      export: "Locked until Final Preview is approved"
    },
    /** The tab nav's own marker for the tab holding the current next action - the answer to "which tab do I open?" without reading anything else. */
    /**
     * 2026-09-26: the tab bar no longer draws this - the checklist on the
     * project's front page and the "what to do next" banner on every other
     * page already name the tab and link to it, and a third marker for the
     * same fact was one of the things the operator had to read and reconcile
     * before acting. Kept (with its aria strings) because
     * SIMPLIFIED_PROJECT_WORKSPACE restores it in one line.
     */
    tabNextBadge: "Next",
    tabNextAriaSuffix: "- your next step is here",
    tabLockedAriaSuffix: "- locked",
    /**
     * REAL 2026-09-25 INCIDENT: the daily operator could not tell which step
     * a project was on, which tab to open, or why a button was disabled, and
     * had to be talked through every click. This block is the one plain
     * sentence shown on EVERY tab naming the real next action AND where it
     * lives. Copy rules: name the tab, name the button exactly as it is
     * labelled elsewhere in this dictionary, and never describe a state the
     * UI has not actually confirmed (see `unknown`/`loadFailed`).
     */
    /**
     * The project's front page, top to bottom: every step it takes to get a
     * finished video, in order, with the one you are on opened up. Copy
     * rules, learned the hard way from two days of talking the operator
     * through clicks on the phone: say what the PERSON does, never what the
     * system does; name a real button exactly as it is labelled elsewhere in
     * this dictionary; and never describe a state that has not actually been
     * confirmed.
     */
    checklist: {
      heading: "Your video, step by step",
      progress: (done: number, total: number): string => `${done} of ${total} done`,
      openAction: (tab: string): string => `Open ${tab}`,
      status: {
        done: "Done",
        doThisNow: "Do this now",
        notYet: "Not yet - finish the step above first",
        ready: "Ready"
      }
    },
    nextAction: {
      heading: "What to do next",
      goToAction: (tab: string): string => `Go to ${tab}`,
      hereBadge: "You are on the right tab",
      unknownTitle: "Checking where this project is…",
      unknownDescription: "Reading this project's real status. Nothing is guessed - this will say what to do next in a moment.",
      loadFailedTitle: "We cannot tell which step this project is on",
      loadFailedDescription:
        "Part of this project's status could not be loaded, so no next step is being guessed here. Reload the page - if it keeps failing, the server or your editing computer may be unreachable.",
      actions: {
        createPlan: {
          title: "Create the video plan",
          description: "Open the Scenes tab and press \"Create Execution Plan\". Nothing can be reviewed, previewed or rendered until this plan exists."
        },
        reviewScenes: {
          title: "Review each scene",
          description: "Open the Scenes tab and settle every scene marked \"Needs your choice\". \"Approve Scenes\" stays disabled until every included scene is reviewed and at least one scene is included."
        },
        approveScenes: {
          title: "Approve the scenes",
          description:
            "Every scene is reviewed. Press \"Approve Scenes\" at the top of the Scenes tab - this unlocks the Preview tab. If this video also needs the tall Reels version, set its layout first (Render Settings, in Advanced view): setting it afterwards sends the plan back to Draft and cancels both preview approvals."
        },
        startFirstPreview: {
          title: "Create the first preview",
          description: "Open the Preview tab and press \"Start execution\". After Effects builds one designed frame for you to check before the rest of the video is built."
        },
        approveFirstPreview: {
          title: "Approve the first preview",
          description: "Your first designed frame is waiting on the Preview tab. Press \"Approve preview\" to let the remaining scenes be built, or \"Reject preview\" to stop here."
        },
        executeRemainingScenes: {
          title: "Build the remaining scenes",
          description: "Open the Preview tab and press \"Continue execution\" until every approved scene has been built."
        },
        configureRenderOutput: {
          title: "Choose which part of the template is your finished video",
          description:
            "Open Export. Under \"Landscape\", pick the piece of the template that is the whole finished video, fill in the two After Effects settings names your editor gave you, and press Save. Render stays greyed out until that is saved."
        },
        reviewFinalPreview: {
          title: "Review the complete video",
          description: "Open the Preview tab, press \"Create Complete Preview\", watch the result, then press \"Approve Final Preview\". Export unlocks only after that approval."
        },
        render: {
          title: "Render the final video",
          description: "Open the Export tab and press Render for each output you need. This runs After Effects on your editing computer and takes a while."
        },
        done: {
          title: "Everything is done",
          description: "Your rendered videos are on the Export tab, ready to play or download."
        }
      }
    },
    /**
     * Why a control is disabled, shown next to the control itself. The
     * 2026-09-25 incident named a silently-disabled button with no
     * explanation as the single worst thing in this UI - so every one of
     * these says both the blocking fact AND what would clear it.
     */
    disabledReason: {
      working: "Working on this right now - it will free up on its own.",
      workerOffline: "Your editing computer is offline. Turn it on and this becomes available again.",
      noWorker: "No editing computer is connected right now. It becomes available as soon as one comes online.",
      staleRevision: "This plan changed somewhere else. Reload the page to get the latest version first.",
      scenesNotReviewed: "Some scenes still need your choice. Settle every scene below first.",
      previewsUpdating: "Scene previews are still updating after your last change. This clears by itself in a moment.",
      scenesAlreadyApproved: "Already approved - the next step is on the Preview tab.",
      planNotReady: "Some scenes are not ready for approval yet. The reasons are listed above.",
      planNotDraft: "This plan is no longer a draft. Reopen it for editing to change the decision.",
      noExecutableScene: "No approved scene can be executed yet. Approve the scenes on the Scenes tab first.",
      allScenesExecuted: "Every approved scene is already built - continue with the complete preview below.",
      scenesNotExecuted: "The approved scene has to finish building on the Preview tab first.",
      finalPreviewAlreadyApproved: "Already approved. Use \"Regenerate Complete Preview\" if the video needs rebuilding.",
      renderNotConfigured: "This output has not been set up yet. Fill in the short setup form just below and press Save.",
      renderConfigStale: "The template changed since this output was set up. Set it up again in the form just below.",
      renderNotReady: "The complete preview has to be approved on the Preview tab before rendering.",
      noCompositionChosen: "Choose a master composition above first.",
      noSceneChosen: "Choose a scene above first.",
      noLayoutChanges: "Nothing has changed yet - adjust a value above to enable saving."
    },
    header: {
      sourceProject: "Source project",
      sourceSha: "Source SHA",
      revision: "Revision",
      status: "Status",
      scenes: "Scenes",
      unresolved: "Unresolved",
      detailsToggle: "Project details",
      /** The one drawer at the foot of every project page holding everything that is not a step in making a video: the technical facts, the Advanced view switch, and Delete Project. */
      settingsDrawerToggle: "Settings and technical details"
    },
    loadErrorTitle: "Could not load this project",
    notFoundTitle: "Project not found",
    notFoundDescription: "This project does not exist, or you no longer have access to it.",
    noPlanTitle: "No execution plan yet",
    noPlanDescription:
      "Create an execution plan from the inspected template before mapping assets, text, timing, and scene decisions.",
    lockedStep: {
      returnToCurrentStepAction: "Return to current step",
      preview: {
        title: "First Preview isn't available yet",
        description: "Your AI Plan must be approved and content matched before First Preview is available."
      },
      export: {
        title: "Export isn't available yet",
        description: "Your Final Preview must be approved before Export is available."
      }
    },
    createPlanAction: "Create Execution Plan",
    creatingPlan: "Creating…",
    createPlanFailedTitle: "Could not create the execution plan",
    staleRevisionTitle: "This plan changed elsewhere",
    staleRevisionDescription: "Another edit was saved to a newer revision. Reload to see the latest plan before editing again.",
    reload: "Reload",
    savingLabel: "Saving…",
    saveFailedTitle: "Could not save this change",
    deleteProjectAction: "Delete Project",
    deleteConfirmTitle: "Delete this project?",
    deleteConfirmDescription: (name: string): string =>
      `"${name}" and everything in it (uploads, work map, scene mappings, previews, and renders) will be permanently deleted. This cannot be undone.`,
    deleteConfirmAction: "Delete permanently",
    deletingAction: "Deleting…",
    deleteCancelAction: "Cancel",
    deleteFailedTitle: "Could not delete this project",
    overview: {
      detailsToggle: "Plan details (for support)",
      projectSection: "Project",
      planSection: "Execution plan",
      safetySection: "Safety / execution state",
      mappingCount: "Mappings",
      approvedLabel: "Approved",
      notApprovedLabel: "Not approved",
      approvedByAt: (by: string, at: string): string => `Approved by ${by} at ${at}`,
      readyTitle: "Ready for approval",
      notReadyTitle: "Not ready for approval",
      blockedReasonsIntro: "Not ready because:",
      unresolvedScenesReason: (count: number): string => `${count} unresolved scene(s)`,
      approveAction: "Approve plan",
      rejectAction: "Reject plan",
      reopenAction: "Reopen for editing",
      executionSection: "Scene execution",
      executeFirstSceneAction: "Execute first approved scene",
      noApprovedSceneTitle: "No approved scene to execute",
      noApprovedSceneDescription: "Approve at least one scene with fully resolved mappings before executing.",
      startExecutionAction: "Start execution",
      continueExecutionAction: "Continue execution",
      approvePreviewAction: "Approve preview",
      rejectPreviewAction: "Reject preview",
      regenerateFirstPreviewAction: "Regenerate First Preview",
      previewImageAlt: "Captured first-frame preview",
      allScenesCompleteLabel: "All approved scenes have been executed - ready to render.",
      finalPreview: {
        title: "Final Preview",
        notReadyTitle: "Your complete preview is not ready yet.",
        notReadyDescription: "Create the complete preview to review the finished video before rendering.",
        workerOffline: "Your editing computer is offline. Turn it on to create the complete preview.",
        createAction: "Create Complete Preview",
        regenerateAction: "Regenerate Complete Preview",
        requestChangesAction: "Request Changes",
        approveAction: "Approve Final Preview",
        approvedBadge: "Approved"
      },
      sessionStatusLabel: "Status",
      sessionWorkerLabel: "Worker",
      sessionProgressLabel: (done: number, total: number): string => `${done} / ${total} scenes completed`,
      sessionStatusPreparing: "Preparing",
      sessionStatusEditing: "Editing",
      sessionStatusAwaitingPreviewApproval: "Awaiting preview approval",
      sessionStatusReadyToRender: "Ready to render",
      sessionStatusRendering: "Rendering",
      sessionStatusCompleted: "Completed",
      sessionStatusPaused: "Paused (worker offline)",
      sessionStatusFailed: "Failed - start a new execution session",
      /**
       * Preview Timing Analysis (live QA, 2026-09-09): a real incident found
       * every existing scene_evidence row had zero real per-layer timing
       * data, so First Preview timestamps were being chosen from average
       * scene duration - never real evidence. This action dispatches two
       * read-only INSPECT_SCENE_EVIDENCE jobs (never SET_TEXT/MAP_FOOTAGE,
       * never a project save) and calculates a real recommended timestamp
       * from their result. Simple Mode shows only `action`/analyzing state/
       * `recommendedLabel`/`applyAction` - every other key here (raw per-
       * label ranges, the overlap range) is Advanced-only, see
       * ProjectPreviewTab's own rendering.
       */
      previewTiming: {
        action: "Analyze Preview Timing",
        failureTitle: "Could not analyze preview timing",
        noSceneFound: "This scene could not be found in the current execution plan.",
        noNestedTargets: "No nested branding targets were found for this scene's approved mappings.",
        evidenceUnavailable: "The Worker's inspection result was not in the expected format.",
        missingWrapperEvidence: "The Worker did not return timing evidence for the expected layer.",
        missingLeafEvidence: (label: string): string => `The Worker did not return timing evidence for "${label}".`,
        recommendedLabel: (seconds: number): string => `Recommended First Preview timestamp: ${seconds}s`,
        rangeLabel: (start: number, end: number): string => `${start}s – ${end}s`,
        overlapLabelHeading: "Both visible together",
        noOverlapNote: "These elements are never visible at the same timestamp - showing the first one's own visible range instead.",
        applyAction: "Use this timestamp"
      }
    },
    revisions: {
      title: "History of your plan",
      /** Plain-language purpose line, before any table: "revision" is engineering vocabulary and this screen used to open with it twice. */
      description:
        "A read-only record of every saved version of this project's plan. Nothing on this page can be changed, undone or restored - it is here so you can see what happened and when.",
      whyItMatters:
        "A new version is saved every time the plan is edited, including from other screens such as the Reels layout. Each new version returns the plan to Draft, so it has to be approved again.",
      tableCaption: "Execution plan revision history",
      revisionColumn: "Revision",
      statusColumn: "Status",
      scenesColumn: "Scenes",
      approvedColumn: "Approved",
      updatedColumn: "Updated",
      currentBadge: "Current",
      emptyTitle: "No revisions yet",
      emptyDescription: "Revision history will appear once this project has an execution plan."
    },
    renderSettings: {
      title: "Render Settings",
      /**
       * Rendered at the top of the tab, before any control (2026-09-27
       * non-developer audit). The old wording - "explicitly choose the master
       * composition each render output uses, never guessed from an active/
       * first/largest composition" - described the IMPLEMENTATION's promise
       * to an engineer, and was not shown on screen at all.
       */
      description:
        "Everything about turning this project into finished video files. The two settings at the top are needed once, before anything can be rendered. The Reels layout below them is only needed if you also want the tall version for phones. \"Tools and diagnostics\" at the foot of the page only reads what After Effects reports - it changes nothing.",
      /** The one disclosure inside an output's card holding the identifier nobody needs in order to use the screen. */
      technicalDetailsToggle: "Technical details",
      variantSection: { LANDSCAPE: "Landscape master", REELS: "Reels master" },
      compositionLabel: "Master composition",
      compositionPlaceholder: "Select a composition…",
      noCompositionOption: "Not configured",
      compositionIdentityLabel: "Manifest composition ID",
      dimensionsLabel: "Dimensions",
      renderSettingsTemplateLabel: "Render Settings template name",
      outputModuleTemplateLabel: "Output Module template name",
      templateHint: "Exact AE Render Queue template name, as it will appear on the real Windows AE install - not yet auto-discovered here.",
      saveAction: "Save",
      savingLabel: "Saving…",
      saveFailedTitle: "Could not save this render configuration",
      savedConfiguredAt: (at: string): string => `Configured ${at}`,
      staleWarningTitle: "This configuration is stale",
      staleWarningDescription: "The source project has changed since this master composition was selected. Re-select it before rendering.",
      noCompositionsTitle: "No compositions available",
      noCompositionsDescription: "This project's manifest has no discovered compositions yet.",
      toolsSection: "Tools and diagnostics",
      inspectCapabilitiesSection: "Render capabilities",
      inspectCapabilitiesAction: "Inspect Render Capabilities",
      inspectCapabilitiesDescription: "Read-only. Asks the worker to report the real AE Render Queue template names and AE version - never mutates or saves anything.",
      buildHorizontalSection: "Build a Landscape composition",
      buildHorizontalAction: "Build Landscape Master",
      buildHorizontalDescription: "Creates a genuine 1920×1080 widescreen composition from the current approved content, with elements repositioned for horizontal presentation - never a crop. The new composition is added to the composition list above automatically once it's ready.",
      buildHorizontalNotReadyTitle: "Not ready yet",
      buildHorizontalNotReadyDescription: "The approved scene must finish executing (see the Preview tab) before a Landscape master can be built from it.",
      reelsLayout: {
        title: "Reels layout (1080×1920)",
        /**
         * REAL 2026-09-27. This card used to say, in as many words, that
         * nothing here measures or fills anything in - and that was true,
         * which is exactly why two hand-made vertical layouts came out
         * wrong. The scene is now measured and the fields arrive filled in.
         * The guarantee that actually holds is narrower and stronger, and
         * every line of copy on this screen has to carry it: NO VALUE IS
         * EVER APPLIED THAT THE REVIEWER DID NOT APPROVE. The system
         * measures and proposes; the person checks, changes and saves; only
         * what was saved is ever executed.
         */
        description:
          "Where each layer of a scene sits in the vertical frame. The scene is measured for you and these fields arrive filled in, so you are checking a starting point instead of working one out. Nothing is ever applied that you did not approve: change anything you disagree with, then save. Only what you save is used, and the vertical composition itself is built the next time this scene is executed.",
        noScenesTitle: "No scenes to lay out",
        noScenesDescription: "This project has no execution plan with an included scene yet - approve the scene mapping first.",
        sceneLabel: "Scene",
        scenePlaceholderOption: "Choose a scene",
        readLayersHint:
          "Read-only. Asks your editing computer to report each top-level layer of this scene: the position, the scale and the real size After Effects holds for it, and whether any of it is animated. Nothing in the template is changed. The fields below are then filled in from those measurements, for you to check and change.",
        readLayersAction: "Read this scene's layers",
        readingLayers: "Reading…",
        readFailedTitle: "Could not read this scene's layers",
        readUnexpectedShape: "The worker's reply did not match the expected layer-facts contract.",
        readNoLayers: "The worker completed the scan but reported no layer facts.",
        readTimedOut: "The layer scan did not finish in time. The worker may still be busy - try again.",
        noLayersTitle: "No top-level layers reported",
        noLayersDescription: "After Effects reported no top-level layer in this scene's composition, so there is nothing to place in the vertical frame.",
        layersTitle: "Layers in this scene",
        valuesAreYours:
          "These fields start filled in from what was measured in the scene - from each layer's real size and position, never from its name. Every one of them is yours to change. The vertical composition is built from what you save here and from nothing else, so nothing reaches the video until you have approved it.",
        /** Shown when a measured layout really did arrive - the heading that tells the reviewer what they are looking at before they read a single number. */
        proposalTitle: "Filled in from the measured scene",
        proposalSummary: (proposedCount: number): string =>
          `${proposedCount} ${proposedCount === 1 ? "layer was" : "layers were"} measured and filled in below. Read them, change anything you disagree with, and save - nothing is applied until you do.`,
        proposalRoleBackground:
          "Measured as this scene's background: it fills the frame today, so it is enlarged to cover the taller frame completely. That is what stops a black band appearing above and below the video.",
        proposalRoleContent:
          "Measured as content: it keeps its own real size, is made smaller only if it would not otherwise fit, and is kept inside the frame so nothing is cut off at the edges.",
        /**
         * An absent measurement is "not measured", never "nothing to do" -
         * so it is said out loud, with the reason when there is one. The
         * usual cause is an editing computer still running an older worker.
         */
        proposalMissingTitle: "This scene was not measured",
        proposalMissingWithReason: (reason: string): string =>
          `The layout could not be measured, so the fields below start empty and every number is yours to enter. The reason given: ${reason}`,
        proposalMissingUnknown:
          "The scan did not return a measured layout, so the fields below start empty and every number is yours to enter. This usually means your editing computer is still running an older version of the worker software.",
        refusalsTitle: "Layers this cannot help with",
        refusalsHint:
          "Nothing was worked out for these, and nothing will be changed in them: each one keeps exactly what the template gives it in the vertical composition.",
        /**
         * One plain sentence per typed refusal reason. The proposal also
         * carries an English `detail` sentence, which is only ever a
         * fallback - what a reader sees is written here, in their own
         * language.
         */
        refusalReason: {
          KEYFRAMED_POSITION_OR_SCALE:
            "Its position or scale is animated. Writing one fixed position over that would destroy the animation, so the layer is left exactly as the template has it.",
          THREE_D_LAYER: "It is a 3D layer. Where it lands on screen depends on the camera as well, which this flat measurement does not cover.",
          PARENTED_LAYER: "It is attached to another layer. Moving it on its own, while the layer it follows stays where it is, would place it wrongly.",
          CAMERA_LAYER: "It is a camera. A camera has no size on screen and no scale to move.",
          LAYER_DISABLED: "It is switched off in the template, so there is nothing to move.",
          NO_VIDEO_CONTENT: "It has no picture of its own - it is sound, or a guide - so there is nothing to move.",
          GEOMETRY_NOT_MEASURED:
            "The scan did not report everything needed about this layer. Reading this scene's layers again usually fixes it.",
          UNREADABLE_TRANSFORM: "Its position, scale or anchor point could not be read at all.",
          UNREADABLE_BOUNDS: "Its real size on screen could not be read, so there is no way to tell how much room it needs.",
          NON_UNIFORM_SOURCE_SCALE:
            "It is stretched by different amounts across and down. A saved layout carries one scale for both directions, and any single value would change this layer's shape.",
          DEGENERATE_GEOMETRY:
            "As the template leaves it, it has no real size on screen - scaled to nothing, or mirrored - so there is no honest way to place it."
        },
        /**
         * REAL 2026-09-27: the first hand-made vertical render came out with
         * the content cut off at both sides and empty bands above and below,
         * because each layer's POSITION was mapped into the tall frame while
         * its scale was left at the original value - so 1920-wide content
         * stayed 1920 wide inside a 1080-wide frame. These two lines state
         * the facts that make that mistake visible. They state, and never
         * compute: no scale is suggested, derived or pre-filled anywhere.
         */
        sourceFrameFact: (widthPx: number, heightPx: number): string =>
          `This scene is ${widthPx}×${heightPx} in the template. The frame you are placing it into is 1080×1920.`,
        sourceFrameUnknown: "This project's manifest does not record this scene's size, so it cannot be shown here.",
        scaleRelationshipNote:
          "Scale is a percentage of the layer's own original size - the same percentage shown on the left, not a percentage of the new frame. Moving a layer does not resize it: content wider than 1080 stays that wide and is cut off at both edges unless you lower its scale too.",
        layerLegend: (layerIndex: number, layerName: string): string => `Layer ${layerIndex}: ${layerName}`,
        currentValues: (position: string, scale: string): string => `Source composition holds position ${position} and scale ${scale}.`,
        currentUnknown: "After Effects did not report a position or a scale for this layer.",
        layerIsThreeD: "This is a 3D layer: where it lands on screen also depends on the camera.",
        layerAnimatedRefusal:
          "This layer's position or scale is animated with keyframes. The build refuses to write a fixed position over keyframed animation rather than destroying it, so no target can be set here - left alone, the layer keeps its own animation in the vertical composition.",
        layerUnreadableRefusal: "This layer's position or scale could not be read (a camera layer has no scale of its own), so no target can be set for it here.",
        includeLabel: "Move this layer in the vertical frame",
        positionXLabel: "X (pixels)",
        positionYLabel: "Y (pixels)",
        scaleLabel: "Scale (%)",
        framePreviewTitle: "Where they will sit",
        framePreviewHint:
          "The 1080×1920 frame, with a marker at every position now in the fields - filled in or changed by you, it always shows what is there right now. The background layer is marked apart from the rest.",
        framePreviewAlt: "The 1080 by 1920 frame with a marker at each position entered",
        outsideFrameWarning: "A position you entered falls outside the 1080×1920 frame. That is allowed - the layer simply will not be visible.",
        incompleteWarning: "Every layer you tick needs an X, a Y and a scale greater than 0.",
        compositionNameLabel: "Name for the vertical composition",
        compositionNameHint: "Your own name for the composition this builds. Nothing is generated from the scene's name.",
        saveAction: "Save this Reels layout",
        saveFailedTitle: "Could not save this Reels layout",
        savedTitle: "Saved Reels layout",
        savedName: (compositionName: string): string => `Composition name: ${compositionName}`,
        savedEntry: (layerIndex: number, positionX: number, positionY: number, scalePercent: number): string =>
          `Layer ${layerIndex} at ${positionX}, ${positionY}, scale ${scalePercent}%`,
        savedNote:
          "Applied the next time this scene is executed: the scene's composition is duplicated, the copy is resized to 1080×1920 and exactly these layers are moved. The original composition is never changed.",
        clearAction: "Remove this Reels layout",
        /**
         * REAL 2026-09-27 INCIDENT (docs/ACCEPTANCE.md). Setting the Reels
         * layout is a plan edit: it writes a new plan version, which returns
         * the plan to Draft and orphans the live execution session together
         * with both of its preview approvals. That is the approval model
         * working - but nothing said so, and the guidance's own order put
         * render configuration AFTER the previews, so following it walked
         * straight into losing an approved plan and a completed session.
         *
         * Copy rules: name every real consequence, name NOTHING that is not
         * genuinely at stake right now (see plan-edit-impact.ts), and say
         * what to do differently next time.
         */
        planEditWarning: {
          inlineNotice:
            "Careful: this project has approved work, and saving a Reels layout undoes some of it. Press the button to see exactly what, before anything is saved.",
          saveTitle: "Saving this Reels layout undoes approvals",
          clearTitle: "Removing this Reels layout undoes approvals",
          intro:
            "The Reels layout is part of the plan, so saving it writes a new version of the plan - and a new version cannot carry approvals that were given to the old one. This will:",
          losesPlanApproval: "Send the plan back to Draft. The scenes have to be approved again.",
          losesSession: "Drop the preview work in progress. The scenes have to be built again from the start.",
          losesFirstPreviewApproval: "Cancel your approval of the first preview.",
          losesFullPreviewApproval: "Cancel your approval of the complete video preview.",
          sessionUnknown:
            "This project's preview progress could not be read just now, so we cannot list exactly what is in flight. If a preview is running, it will be dropped.",
          advice: "None of this happens if the Reels layout is set BEFORE the plan is approved.",
          confirmSaveAction: "Save anyway",
          confirmClearAction: "Remove anyway",
          cancelAction: "Go back"
        }
      },
      /**
       * Both diagnostics below had every single string hardcoded in English
       * inside the component - including a placeholder naming one specific
       * template's composition id. Moved here so they are translatable at
       * all, and rewritten for someone who does not know what a composition,
       * a manifest or a dispatch is.
       */
      timelineDiagnostics: {
        title: "Check a finished video's timeline",
        description:
          "Read-only. Asks your editing computer what After Effects really reports for the piece of the template you chose as the finished video: how long it runs, and when each layer starts and ends. Nothing is changed and nothing is saved.",
        checkAction: (variantLabel: string): string => `Check ${variantLabel}`,
        resultHeading: (variantLabel: string, jobId: string): string => `${variantLabel} - reported by job ${jobId}`,
        unexpectedShape: "The reply did not match the shape this screen expects.",
        nothingReported: "The scan finished but reported no timeline for this composition."
      },
      describeAnyComposition: {
        title: "Look inside any part of the template",
        description:
          "Read-only. Reports what After Effects really holds for any part of this template - not only the two pieces chosen as finished videos. Used to work out why a scene goes black, or why a layer never appears. Nothing is changed and nothing is saved.",
        compositionLabel: "Which part of the template",
        compositionPlaceholder: "Choose a part of the template",
        compositionHint: "The template's own parts, exactly as the last inspection found them - including the pieces nested inside other scenes.",
        modeLabel: "What to report",
        modeTiming: "Timing - how long it runs, and when each layer starts and ends",
        modeLayerDetails: "Layers - transparency, keyframes, speed and source",
        modeTransforms: "Position, scale, camera and effects",
        readAction: "Read it",
        reading: "Reading…",
        failedTitle: "Could not read this",
        noWorkerDescription: "This project's editing computer is not offering the read-only scan this needs right now.",
        resultHeading: (compositionName: string, jobId: string): string => `${compositionName} - reported by job ${jobId}`,
        unexpectedShape: "The reply did not match the shape this screen expects.",
        nothingReported: "The scan finished but reported nothing of this kind for this composition."
      },
      renderAction: "Render",
      sessionNotReadyTitle: "Not ready to render yet",
      sessionNotReadyDescription: "Every approved scene must be executed and its first preview approved before rendering - see the Preview tab."
    },
    export: {
      description: "Render and download the final Landscape and Reels videos.",
      renderAction: (variantLabel: string): string => `Render ${variantLabel}`,
      notConfiguredTitle: "Not set up yet",
      /**
       * REAL 2026-09-26 DEAD END. This line used to read "ask your editor to
       * finish it in Advanced mode", because the only form that could set an
       * output up lived on the Render Settings tab - which the normal nav
       * does not list. That made the Export button permanently greyed out
       * for anyone without an editor on the phone. The form is now rendered
       * directly underneath this message (ProjectExportTab), so the message
       * says where it is instead of who to ask. The old wording is gone
       * rather than kept unused, so it cannot quietly come back.
       */
      setUpBelowDescription: "This output needs setting up once before it can be rendered. The short form for it is right below.",
      notReadyTitle: "Not ready yet",
      notReadyDescription: "Finish approving every scene and the Final Preview before this export is ready."
    },
    editDrawer: {
      title: "Edit scene mapping",
      textLabel: "Text",
      textHint: "Leave empty to clear the current text.",
      assetLabel: "Asset",
      assetUnmappedOption: "Unmapped",
      assetHint: "Only assets already uploaded to this project's Asset Catalog can be selected.",
      assetTimestampLabel: "Asset timestamp (seconds)",
      templateCopyIdenticalWarning: "This text is still exactly the template's own wording.",
      templateCopyVariantWarning: "This text differs from the template's own wording only in formatting.",
      templateCopyUnknownWarning: "This project's manifest does not record the template's own text for this layer, so it cannot be checked. Re-run template inspection.",
      templateCopyCaptureFailedWarning:
        "This layer's template text could not be read completely when the project was inspected, so it cannot be checked. Re-running template inspection usually resolves this.",
      templateCopyTooLargeWarning: (codeUnitLength: number) =>
        `This layer's template text is ${codeUnitLength} characters, which is larger than this system can verify. Re-running inspection will not change that: shorten the text in the template, or remove this text mapping.`,
      templateCopyStaleWarning: "The recorded decision was made about different text.",
      templateCopyTemplateTextLabel: "Template's own text",
      templateCopyExcerptLabel: "Template's own text (excerpt only)",
      templateCopyExcerptNote: (codeUnitLength: number) =>
        `This layer's template text is ${codeUnitLength} characters long, so only the beginning is shown. The comparison above uses the complete text, not this excerpt.`,
      templateCopyDecisionHint: "Choose one: replace the wording, or deliberately keep the template's. Leaving it undecided blocks approval.",
      templateCopyReplace: "I replaced it",
      templateCopyKeep: "Keep template text",
      templateCopyClearDecision: "Undo this decision",
      templateCopyDecidedReplace: "Recorded: replaced deliberately",
      templateCopyDecidedKeep: "Recorded: keeping the template's wording",
      templateCopyPendingReplace: "Chosen, not saved: replaced deliberately. Press Save changes to record it.",
      templateCopyPendingKeep: "Chosen, not saved: keeping the template's wording. Press Save changes to record it.",
      slotFindingsTitle: "This slot needs a decision",
      slotClassificationLabel: "Structure says",
      slotClassificationDeviceScreen: "a device screen (a window cut into rendered hardware)",
      slotClassificationFlatCard: "a flat card (a rectangle a designer drew)",
      slotClassificationUnknown: "not clear from the structure",
      slotConfidence: (percent: number) => `${percent}% confident`,
      slotEvidenceLabel: "What the structure shows",
      slotEvidenceFrameTitle: "Evidence frame",
      slotEvidenceFrameHint: (seconds: number) => `Capture the slot at ${seconds.toFixed(2)}s, the moment it is genuinely on screen, and look at it before deciding.`,
      slotEvidenceFrameMissing: "No evidence frame has been captured for this scene yet - one is required before this slot can be decided.",
      slotEvidenceFrameStale: (seconds: number) => `The captured frame does not show the moment this slot is on screen (${seconds.toFixed(2)}s). Capture it again.`,
      slotEvidenceFrameNoMoment: "This slot never presents a moment where it is provably visible, so no frame can show it. Fix the layer's timing in the template, or remove this mapping.",
      slotEvidenceFrameCapture: "Capture evidence frame",
      slotEvidenceFrameCapturing: "Capturing...",
      slotEvidenceFrameAlt: "The captured frame of this scene",
      slotDecisionHint: "Decide only from the frame above: accept these findings, or say what this slot actually is.",
      slotDecisionAccept: "Accept - I looked, this is right",
      slotDecisionOverrideDeviceScreen: "It is a device screen",
      slotDecisionOverrideFlatCard: "It is a flat card",
      slotDecisionClear: "Undo this decision",
      slotDecisionRecordedAccept: "Recorded: accepted after looking at the frame",
      slotDecisionRecordedOverride: "Recorded: the reviewer says this slot is something else",
      slotDecisionPendingAccept: "Chosen, not saved: accepted after looking at the frame. Press Save changes to record it.",
      slotDecisionPendingOverride: "Chosen, not saved: this slot is something else. Press Save changes to record it.",
      slotDecisionStale: "This decision was made about different findings, so it no longer covers them. Look again and decide.",
      finalDurationLabel: "Final duration (seconds)",
      instructionsLabel: "Instructions / notes",
      unsavedChangesNotice: "Unsaved changes on this scene. Nothing here is recorded until you press Save changes - closing this drawer discards it.",
      discardConfirmTitle: "Discard the unsaved changes?",
      discardConfirmDescription: "Nothing on this scene has been saved yet. Closing now discards every change and decision made here.",
      discardConfirmKeepEditing: "Keep editing",
      discardConfirmDiscard: "Discard and close",
      save: "Save changes",
      cancel: "Cancel"
    }
  },
  assetsTab: {
    title: "Asset Catalog",
    description: "Client-supplied images, videos, logos, audio, and documents for this project.",
    uploadTitle: "Upload asset",
    fileLabel: "File",
    mediaKindLabel: "Type override",
    mediaKindAuto: "Detect automatically",
    mediaKindLogoHint: "Only valid for an image file - marks it as the client/company logo.",
    uploadAction: "Upload",
    uploading: "Uploading…",
    uploadFailedTitle: "Could not upload this file",
    emptyTitle: "No assets uploaded",
    emptyDescription: "Upload the client's images, videos, logos, audio, or documents here.",
    labelLabel: "Label",
    notesLabel: "Notes",
    labelPlaceholder: "e.g. Client logo",
    notesPlaceholder: "Optional notes for this asset",
    saveDetails: "Save",
    savingDetails: "Saving…",
    deleteAction: "Delete",
    deleteConfirmTitle: "Delete this asset?",
    deleteConfirmDescription: (filename: string): string => `"${filename}" will be permanently deleted. This cannot be undone.`,
    deleteConfirmAction: "Delete permanently",
    deleteCancelAction: "Cancel",
    deleteFailedTitle: "Could not delete this asset",
    mediaKind: {
      IMAGE: "Image",
      VIDEO: "Video",
      LOGO: "Logo",
      AUDIO: "Audio",
      DOCUMENT: "Document",
      OTHER: "Other"
    },
    sizeLabel: "Size",
    uploadedLabel: "Uploaded",
    shaLabel: "SHA-256"
  },
  workMapTab: {
    title: "Work Map",
    /**
     * "Work Map" is this product's own name for the brief, and it is printed
     * on the tab - so the first line of the screen explains it rather than
     * assuming it (2026-09-27 non-developer audit). The previous copy spoke
     * about "the client" in the third person to an audience that IS the
     * client, and named two internal concepts ("the execution plan", "Scene
     * Mapping") before saying what the page was for.
     */
    description:
      "Your Work Map is what you asked for, in your own words, scene by scene. It is a note of what you want - nothing here changes a video on its own.",
    intro:
      "One row for each scene you described. Fill in as much or as little as you like: a file, some text, how long it should run, a note. Each row only becomes part of the video once you match it to a scene and approve it on the Scenes tab.",
    addRow: "Add row",
    removeRow: "Remove",
    save: "Save work map",
    saving: "Saving…",
    saveFailedTitle: "Could not save the work map",
    emptyTitle: "No work map entries yet",
    emptyDescription: "Add a row for each scene the client described, even before a template has been inspected.",
    fields: {
      sourceReference: "What you call this scene",
      /** Both of these are pickers showing real names; the labels used to say "ID" while the control never showed one. */
      sourceCompositionId: "Scene in the template",
      desiredAssetId: "File to use",
      desiredText: "Text to show",
      assetTimestampSeconds: "Start this file at (seconds)",
      desiredDurationSeconds: "How long it should run (seconds)",
      instructions: "Anything else we should know"
    },
    fieldHints: {
      desiredAssetId: "Only files already uploaded on the Files tab appear here. Choosing one records what you want; it reaches the video when you approve it on the Scenes tab.",
      sourceCompositionId: "The template's own scenes appear here once it has been inspected. Leave it unmatched if you are not sure which one you mean."
    },
    ai: {
      heading: "Tell AI what you want",
      textareaLabel: "Describe your video",
      placeholder:
        "Use the login screen recording first, then show checkout.\nKeep the original template animations.\nUse our logo at the end.\nKeep the final video around 20 seconds.",
      createPlanAction: "Create Video Plan",
      creatingPlan: "Creating your plan…",
      addDetailsManually: "Add details manually",
      createPlanFailedTitle: "Could not create a video plan",
      notConfiguredHint: "Connect an AI provider in Settings to create a video plan with AI, or add details manually below."
    },
    planPreview: {
      title: "Your Video Plan",
      description: "Review what AI planned for each scene. You can edit any row, or use Scene Mapping to fine-tune it further.",
      columns: { scene: "Scene", content: "Content", text: "Text", duration: "Duration", action: "Action" },
      noContent: "—",
      editAction: "Edit",
      tellAiAgainAction: "Tell AI again",
      advancedDetailsToggle: "Advanced details",
      /** The raw identifiers this disclosure holds are support material, not something anyone needs in order to use the screen - so it now says so, and labels them for what they are instead of reusing the form's field labels. */
      advancedDetailsHint: "Internal identifiers, useful only when someone is helping you debug a problem. Nothing here has to be read to use this page.",
      advancedCompositionIdLabel: "Template scene id",
      advancedAssetIdLabel: "File id",
      simple: {
        description: "AI has prepared your video plan. Review it below, then approve it to continue.",
        summaryTitle: "AI found",
        summaryScenes: (n: number): string => `${n} main scene${n === 1 ? "" : "s"}`,
        summarySupporting: (n: number): string => `${n} supporting nested composition${n === 1 ? "" : "s"}`,
        summaryUnresolved: (n: number): string => `${n} unresolved item${n === 1 ? "" : "s"}`,
        noPlaceholdersNotice:
          "AI inspected this template but did not detect standard editable placeholders. DYO can preserve the original animation and nested structure, but automatic replacements will only be made where a safe mapping is confirmed.",
        thumbnailPlaceholder: "Scene preview not generated yet",
        sceneTitleMain: "Main Scene",
        sceneTitleNumbered: (n: number): string => `Scene ${n}`,
        templateCompositionLabel: (name: string): string => `Template composition: ${name}`,
        cardPlanTitle: "AI plans to:",
        cardPlanPreserveAnimation: "Preserve original animation",
        cardPlanPreserveTiming: "Preserve original timing",
        cardPlanKeepConnected: "Keep supporting compositions connected",
        cardPlanReplaceSafe: "Replace only safely mapped content",
        replaceWithLabel: "Content",
        noReplacementPlanned: "No content replacement planned for this scene - DYO will keep the original animation.",
        textLabel: "Text",
        noEditableText: "No editable text detected",
        timingLabel: "Timing",
        usesOriginalTiming: "Uses the template's original timing",
        durationSuffix: (n: number): string => `${n}s`,
        aiNoteLabel: "AI note:",
        editPlanAction: "Edit Plan",
        askAiToImproveAction: "Ask AI to Improve",
        approvePlanAction: "Approve AI Plan",
        approvingPlan: "Approving…",
        approvePlanFailedTitle: "Could not approve this plan",
        approvePlanHelper: "Approving this plan unlocks Match Your Content.",
        continueToMappingAction: "Continue to Match Your Content"
      }
    },
    picker: {
      assetNoneOption: "No asset",
      sceneNoneOption: "No matching scene yet",
      backToSimpleView: "Back to simple view"
    }
  },
  mappingAssistant: {
    title: "Mapping Assistant",
    description: "Proposes scene/placeholder mappings from real evidence - the Template Manifest, Asset Catalog, Work Map, brand inputs, and your own instructions. Nothing here is ever applied automatically.",
    generateAction: "Generate suggestions",
    generating: "Generating…",
    aiAvailable: "AI: available",
    aiUnavailable: "AI: not configured (deterministic only)",
    connectProviderHint: "Connect an AI provider in Settings to use AI Mapping Assistant.",
    emptyTitle: "No suggestions yet",
    emptyDescription: "Generate suggestions to see real, evidence-backed proposals for unresolved scenes.",
    allResolvedTitle: "Nothing needs your attention",
    allResolvedDescription: "Every remaining item was resolved automatically - see \"Resolved automatically\" below.",
    sourceDeterministic: "Deterministic",
    sourceAi: "AI Suggested",
    confidenceLabel: (percent: number): string => `Confidence: ${percent}%`,
    suggestedAssetLabel: "Suggested asset",
    suggestedTextLabel: "Suggested text",
    suggestedTimestampLabel: "Suggested asset timestamp",
    suggestedDurationLabel: "Suggested duration",
    workMapConflict: "This conflicts with a Work Map entry - review carefully before accepting.",
    acceptAction: "Accept",
    rejectAction: "Reject",
    historyTitle: "Reviewed",
    userConfirmed: "User Confirmed",
    rejectedLabel: "Rejected",
    keepOriginalLabel: "Keep original",
    resolvedLabel: "Resolved",
    resolvedSectionTitle: (n: number): string => `Resolved automatically (${n})`,
    evidenceKind: {
      FACT: "Fact",
      USER_INTENT: "User intent",
      AI_INFERENCE: "AI inference"
    },
    sceneEvidenceLabel: "Scene evidence",
    sceneEvidenceStatus: {
      AVAILABLE: "Evidence inspected — AI accuracy improved",
      STALE: "Stale (captured against an older version of this project)",
      NOT_INSPECTED: "Not inspected"
    },
    confidenceLevel: {
      high: "High",
      medium: "Medium",
      needsReview: "Needs review"
    },
    whyThisSuggestion: "Why this suggestion?",
    sceneGroupFallback: "Ungrouped",
    improveAccuracyAction: "Improve AI accuracy",
    improvingAccuracy: "Sending…",
    improveAccuracyQueued: "Sent to your editing computer. This can take a few minutes - check back and generate suggestions again once it's done.",
    editingComputerOffline: "Your editing computer is offline. Turn it on to improve AI accuracy.",
    bulk: {
      resolvedCount: (n: number): string => `${n} resolved automatically`,
      safeCount: (n: number): string => `${n} safe suggestion${n === 1 ? "" : "s"} ready`,
      needsReviewCount: (n: number): string => `${n} need${n === 1 ? "s" : ""} review`,
      selectedCount: (n: number): string => `${n} selected`,
      acceptAllSafeAction: "Accept All Safe Suggestions",
      acceptSelectedAction: (n: number): string => `Accept Selected (${n})`,
      acceptAllInSceneAction: "Accept All in This Scene",
      selectSuggestionLabel: "Select this suggestion for bulk accept",
      confirmTitle: "Accept these suggestions?",
      confirmDescription: (n: number): string =>
        `You're about to accept ${n} safe suggestion${n === 1 ? "" : "s"}. Suggestions needing review are never included automatically.`,
      cancelAction: "Cancel",
      confirmAction: "Accept Suggestions",
      accepting: "Accepting…"
    }
  },
  helpTooltips: {
    timestamp: "Choose where an uploaded video should start from.",
    duration: "How long this scene should appear in the final video.",
    needsReview: "This suggestion isn't confident enough to accept automatically - a person should check it before it's used.",
    firstPreview: "A quick look at one designed frame, so you can approve the look before every scene is built.",
    finalPreview: "The complete video with every scene in place, for you to review and approve before the final render.",
    landscape: "The standard widescreen version of your video.",
    reels: "Creates a native 1080×1920 vertical version. DYO repositions the real scene elements instead of simply cropping the Landscape video.",
    safeSuggestions: "Suggestions DYO is confident about. They're grouped here so you can approve several at once instead of one at a time."
  },
  workspaceMode: {
    simpleAction: "Simple",
    advancedAction: "Advanced",
    toggleAriaLabel: "Switch between Simple and Advanced view"
  },
  simpleScenes: {
    emptyTitle: "No scenes yet",
    emptyDescription: "Scenes will appear here once your video plan is ready.",
    status: {
      ready: "Ready",
      needsChoice: "Needs your choice",
      noChangeNeeded: "No content matching required",
      analyzing: "Analyzing…",
      generating: "Preview generating…",
      outdated: "Preview outdated"
    },
    screenLabel: "Screen",
    textLabel: "Text",
    noTextLabel: "No text set",
    durationLabel: "Duration",
    durationSeconds: (seconds: number): string => `${seconds.toFixed(1)} sec`,
    durationUnset: "Not set yet",
    noAssetAssigned: "No asset assigned yet",
    originalContentKept: "Original content kept",
    originalTextPreserved: "Original text preserved",
    originalTimingPreserved: "Original timing preserved",
    previewSceneAction: "Preview Scene",
    generatingPreviewAction: "Generating…",
    regeneratePreviewAction: "Regenerate Preview",
    editAction: "Edit",
    advancedDetailsToggle: "Advanced details",
    plannedPreviewLabel: "Planned preview — not yet rendered in After Effects",
    aePreviewLabel: "After Effects preview",
    outdatedPreviewHint: "This scene changed since this preview was captured - it may no longer match. Generate a new preview to see the current result.",
    noPreviewYetHint: "No preview yet. Click \"Preview Scene\" to generate one from the real After Effects project.",
    previewErrorPrefix: "Could not generate a preview:",
    reviewQueueTitle: "Needs your review",
    reviewQueueEmptyDescription: "Nothing needs your input right now.",
    currentTextLabel: (text: string): string => `Text currently: "${text}"`,
    suggestedTextLabel: (text: string): string => `Claude suggests: "${text}"`,
    keepOriginalAction: "Keep original",
    useSuggestionAction: "Use suggestion",
    approveScenesAction: "Approve Scenes",
    approvingScenes: "Approving…",
    allScenesReadyHint: "Every scene is ready - approve to continue.",
    scenesApprovedHint: "Scenes approved - continue to First Preview.",
    scenesNotReadyHint: "Finish reviewing every scene below before approving.",
    previewsUpdatingHint: "Updating previews for scenes you just changed - this only takes a moment, no action needed.",
    storyboardTitle: "Storyboard",
    playFullPreviewAction: "Play Full Preview",
    workerOfflineHint: "No computer is online to generate this preview right now."
  }
} as const;
