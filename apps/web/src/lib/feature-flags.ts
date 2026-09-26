/**
 * Login-only mode (2026-08-28): public self-signup is temporarily disabled
 * ahead of client acceptance - flip this back to `true` to re-enable it.
 * Nothing about the Signup implementation itself was touched or removed;
 * see app/(auth)/signup/page.tsx, app/api/auth/signup/route.ts, and
 * components/auth/SignupPageContent.tsx, all of which check this same
 * flag rather than having their own logic deleted.
 */
export const SIGNUP_ENABLED = false;

/**
 * SUBTRACTION PASS (2026-09-26). The daily operator of this dashboard said,
 * in their own words, "bahut complex hai, samajh nahi aa raha" - it is too
 * complex, they cannot follow it - and then, more precisely: "steppers theek
 * nahi... upar kuch hai neeche kuch hai" (something up top, something else
 * below) and "extra jo jo hai remove kr do" (remove whatever is extra).
 *
 * Before this flag, every project page stacked six layers of chrome above
 * any actual content: a back link, a header carrying a red Delete button and
 * a Simple/Advanced mode toggle, a details disclosure of engineering facts,
 * a seven-chip progress stepper, the "what to do next" banner, and a tab bar
 * that also drew its own "Next" marker. Three of those answered the same
 * question - where am I, what next - so a person had to read three things to
 * learn one fact, and still had to understand the app's structure first.
 *
 * With this flag true:
 *  - the seven-chip stepper is not drawn as page chrome (ProjectChecklist on
 *    the project's own front page shows the same seven steps, from the same
 *    single derivation, with the current one opened and its action in it);
 *  - the tab bar stops drawing its own "Next" badge (the checklist and the
 *    banner already name the tab and link to it);
 *  - the Simple/Advanced toggle, the engineering facts and Delete Project
 *    move out of the top header into one disclosure at the foot of the page.
 *
 * Nothing is deleted and no route is closed: every tab, including the ones
 * only Advanced view lists, is still reachable by its own URL, and flipping
 * this to false restores the previous chrome exactly.
 */
export const SIMPLIFIED_PROJECT_WORKSPACE = true;
