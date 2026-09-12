/**
 * VERBATIM `ae_health` response captured from the real FAHADNAKASH QA
 * machine (INSPECT_TEMPLATE job, 2026-09-12), copied byte-for-byte out of
 * that job's own persisted `toolCalls` capture - never hand-written and
 * never tidied up.
 *
 * It exists because a health probe rejected this exact payload as an
 * "unrecognized-health-shape" while the bridge was genuinely live, which
 * reported a working machine as UNKNOWN and blocked every dispatch. Any
 * future change to the health parser must keep accepting it.
 */
export const REAL_FAHADNAKASH_AE_HEALTH_CONTENT: unknown = [
  {
    "text": "{\n  \"connected\": true,\n  \"ae_running\": true,\n  \"ensured\": {\n    \"ok\": true,\n    \"kicked\": false,\n    \"aeRunning\": true,\n    \"afterFxPath\": \"C:\\\\Program Files\\\\Adobe\\\\Adobe After Effects 2026\\\\Support Files\\\\AfterFX.exe\",\n    \"message\": \"Bridge already live\",\n    \"instances\": 1\n  },\n  \"instances\": [\n    {\n      \"instanceId\": \"default\",\n      \"aeVersion\": \"26.3x87\",\n      \"projectName\": \"App_Promo%20(converted).aep\",\n      \"projectPath\": \"C:\\\\DYO-Agent\\\\copies\\\\mixkit-smartphone-promo-596\\\\596\\\\App_Promo (converted).aep\",\n      \"lastSeen\": \"2026-09-12T11:58:35Z\",\n      \"pollMs\": 1500,\n      \"protocolVersion\": 1\n    }\n  ],\n  \"health\": {\n    \"connected\": true,\n    \"listening\": true,\n    \"aeVersion\": \"26.3x87\",\n    \"projectOpen\": true,\n    \"projectName\": \"Untitled\",\n    \"projectPath\": \"C:\\\\DYO-Agent\\\\copies\\\\mixkit-smartphone-promo-596\\\\596\\\\App_Promo (converted).aep\",\n    \"activeComp\": \"Main_Comp\",\n    \"numItems\": 46,\n    \"bridge\": \"ae-mcp-engine\",\n    \"protocolVersion\": 1,\n    \"home\": \"C:\\\\Users\\\\Fahad Nakash\"\n  },\n  \"note\": \"Bridge live via Startup poller \u2014 no script popups.\"\n}",
    "type": "text"
  }
];
