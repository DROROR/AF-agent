/**
 * Turns a raw worker-reported job error into a plain sentence about what
 * to DO about it, where the raw text alone would leave an operator stuck.
 *
 * REAL 2026-09-25 INCIDENT, and the reason this exists. Three
 * INSPECT_SCENE_EVIDENCE jobs failed and recorded this, verbatim, as the
 * whole reason a human was given:
 *
 *     [ { "code": "unrecognized_keys",
 *         "keys": [ "slotEvidenceMappingId" ], ... } ]
 *
 * That is a Zod validation dump, and it is genuinely the right thing to
 * have STORED - it names the exact key, which is what made the cause
 * findable. It is the wrong thing to be the entire explanation offered to
 * the person using the product, who cannot act on it at all.
 *
 * The cause is always the same shape: the worker validates its job payload
 * with a `.strict()` schema, so a payload carrying a field that the
 * worker's OWN bundled schema does not know is rejected outright. A field
 * only reaches a payload because the server knows it, so the worker is
 * behind the server - an editing computer running an older worker build.
 * (`slotEvidenceMappingId` was added on 2026-09-24; the worker that
 * rejected it predates it.)
 *
 * Nothing here rewrites or replaces the stored error: every caller shows
 * this ALONGSIDE the raw text, never instead of it. An explanation that
 * swallowed the evidence would have made this very incident harder to
 * diagnose, not easier.
 *
 * DELIBERATELY NOT A VERSION CHECK. The worker reads its own build marker
 * (BUILD_INFO.json) but never sends it - the heartbeat carries status,
 * capabilities and After Effects' version, and no worker version at all.
 * So there is no version to compare, and this recognises the FAILURE
 * rather than predicting it. Recognising a failure that has already
 * happened cannot produce a false alarm on a healthy worker.
 */

export const JOB_ERROR_EXPLANATIONS = [
  /**
   * The worker rejected the job payload because it carried a field its own
   * schema does not know - i.e. the worker build is older than the server.
   */
  "WORKER_BEHIND_SERVER"
] as const;
export type JobErrorExplanation = (typeof JOB_ERROR_EXPLANATIONS)[number];

/**
 * Zod's own wording for "this object had a key I do not recognise",
 * matched on the machine-readable `code` rather than on the human message,
 * which is localised and reworded between Zod versions. Both the JSON
 * form (a stringified issue array, which is what actually reaches the
 * jobs table) and the flattened prose form are accepted, because the
 * worker's error path has produced both.
 */
const UNRECOGNIZED_KEYS = /"code"\s*:\s*"unrecognized_keys"|unrecognized_keys|[Uu]nrecognized key\(s\) in object/;

/**
 * What this error really means, or null when there is nothing useful to
 * add - the overwhelmingly common case, and the honest answer. Returning
 * a vague explanation for every unrecognised failure would teach people
 * to skip the one that matters.
 */
export function explainJobError(rawMessage: string | null | undefined): JobErrorExplanation | null {
  if (typeof rawMessage !== "string" || rawMessage.trim() === "") {
    return null;
  }
  if (UNRECOGNIZED_KEYS.test(rawMessage)) {
    return "WORKER_BEHIND_SERVER";
  }
  return null;
}
