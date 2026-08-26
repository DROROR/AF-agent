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
    UNKNOWN: "Unknown"
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
    description: "Set up a new video production project. Nothing here is saved yet.",
    stepperLabel: "Project setup steps",
    steps: {
      details: "Project details",
      template: "Template",
      "work-map": "Work map",
      assets: "Assets",
      inspection: "Template inspection",
      scenes: "Scene table",
      review: "Review / approval",
      render: "Render"
    },
    submitForApproval: "Submit for approval",
    submitDisabledTitle: "Project intake is not yet connected to a backend",
    fields: {
      projectName: "Project name",
      projectNamePlaceholder: "e.g. Cognetica - Spring launch",
      client: "Client",
      clientPlaceholder: "e.g. Cognetica",
      orientation: "Orientation",
      orientationHint: "Landscape and native 1080x1920 Reels are both produced from one project.",
      orientationBoth: "Landscape + Reels",
      orientationLandscape: "Landscape only",
      orientationReels: "Reels only"
    },
    template: {
      title: "Template library is not connected yet",
      description: "Once template intake exists server-side, approved Envato templates will be selectable here."
    },
    workMap: {
      title: "Work map upload is not connected yet",
      description: "This step will accept the client's asset/text work map once the intake API exists."
    },
    assets: {
      title: "Asset upload is not connected yet",
      description: "Client-supplied images, videos, and logos will be attached to the project here."
    },
    inspection: {
      title: "Template inspection has not been run for this project",
      description:
        "INSPECT_TEMPLATE is wired end-to-end on the real worker (see Workers), but this project-intake flow does not yet dispatch a job automatically. Results will populate template-manifest.json here once it does."
    },
    review: {
      title: "Approval gates are not connected yet",
      description: "Scene plan, first frame, branding, and full-preview approvals will appear here - see the Approvals page for the same gates."
    },
    render: {
      title: "Render dispatch is not connected yet",
      description:
        "Landscape and Reels render jobs will be started and tracked here once the render pipeline is wired to a project - see the Renders page."
    },
    stepNotAvailableTitle: "Not available",
    stepNotAvailableDescription: "This step is not yet implemented."
  },
  jobs: {
    title: "Jobs / Queue",
    description: "Jobs currently claimed by a worker, plus the full queue history once available.",
    unavailableTitle: "Jobs unavailable",
    currentlyActive: "Currently active",
    workerDataUnavailableTitle: "Worker data unavailable",
    workerDataUnavailableDescription: "Could not load worker records from the API.",
    emptyTitle: "No jobs currently claimed",
    emptyDescription: "Jobs a worker is actively running will appear here.",
    tableCaption: "Currently claimed jobs",
    jobIdColumn: "Job ID",
    workerColumn: "Worker",
    pendingTitle: "Full queue history is not available yet",
    pendingDescription:
      "The API supports a worker claiming and reporting its own job, but there is no GET endpoint yet to list job operation, status, timestamps, or errors across the queue. This section will show that once such an endpoint exists (see docs/JOB-DISPATCH.md)."
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
    mcp: "MCP",
    aeVersion: "AE version",
    maxConcurrency: "Max concurrency",
    currentJob: "Current job",
    capabilities: "Capabilities",
    lastHeartbeat: "Last heartbeat",
    registered: "Registered",
    lastUpdated: "Last updated"
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
    description: "Final render outputs, once the recoverable aerender pipeline is wired to a project.",
    outputs: {
      landscape: { title: "Landscape", description: "Standard 16:9 landscape output." },
      reels: { title: "Reels (1080x1920)", description: "Native vertical composition, repositioned elements - not a simple crop." }
    },
    noRenderTitle: "No render has been produced yet",
    preview: "Preview",
    download: "Download",
    pendingTitle: "Render dispatch is not connected yet",
    pendingDescription:
      "Render status, output location, and preview/download actions will become real once a project can reach the render stage and aerender jobs are dispatched and tracked."
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
      "The browser never calls the control-plane API directly - all data on this dashboard is proxied server-side. There is nothing to configure here today."
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
  projectWorkspace: {
    backToProjects: "Back to Projects",
    tabs: {
      overview: "Overview",
      scenes: "Scene Mapping",
      assets: "Assets",
      workMap: "Work Map",
      revisions: "Revisions"
    },
    header: {
      sourceProject: "Source project",
      sourceSha: "Source SHA",
      revision: "Revision",
      status: "Status",
      scenes: "Scenes",
      unresolved: "Unresolved"
    },
    loadErrorTitle: "Could not load this project",
    notFoundTitle: "Project not found",
    notFoundDescription: "This project does not exist, or you no longer have access to it.",
    noPlanTitle: "No execution plan yet",
    noPlanDescription: "This project has not had an execution plan created for it yet.",
    staleRevisionTitle: "This plan changed elsewhere",
    staleRevisionDescription: "Another edit was saved to a newer revision. Reload to see the latest plan before editing again.",
    reload: "Reload",
    savingLabel: "Saving…",
    saveFailedTitle: "Could not save this change",
    overview: {
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
      reopenAction: "Reopen for editing"
    },
    revisions: {
      title: "Revision history",
      description: "Every persisted revision of this execution plan.",
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
    editDrawer: {
      title: "Edit scene mapping",
      textLabel: "Text",
      textHint: "Leave empty to clear the current text.",
      assetLabel: "Asset",
      assetUnmappedOption: "Unmapped",
      assetHint: "Only assets already uploaded to this project's Asset Catalog can be selected.",
      assetTimestampLabel: "Asset timestamp (seconds)",
      finalDurationLabel: "Final duration (seconds)",
      instructionsLabel: "Instructions / notes",
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
    description: "The client's own intent for each scene - what they want used, not yet what the plan will execute.",
    intro:
      "This describes what the client wants (desired asset, text, timing, instructions) - it is never automatically applied to the execution plan. Use Scene Mapping to turn an entry into a real, approved mapping.",
    addRow: "Add row",
    removeRow: "Remove",
    save: "Save work map",
    saving: "Saving…",
    saveFailedTitle: "Could not save the work map",
    emptyTitle: "No work map entries yet",
    emptyDescription: "Add a row for each scene the client described, even before a template has been inspected.",
    fields: {
      sourceReference: "Client's scene reference",
      sourceCompositionId: "Matched composition ID",
      desiredAssetId: "Desired asset ID",
      desiredText: "Desired text",
      assetTimestampSeconds: "Asset timestamp (seconds)",
      desiredDurationSeconds: "Desired duration (seconds)",
      instructions: "Instructions"
    },
    fieldHints: {
      desiredAssetId: "A real asset ID from this project's Asset Catalog - not yet validated here, only when actually mapped in Scene Mapping.",
      sourceCompositionId: "Leave empty if no template has been inspected yet."
    }
  }
} as const;
