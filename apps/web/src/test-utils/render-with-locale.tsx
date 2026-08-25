import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { LocaleProvider } from "../components/LocaleProvider";
import type { Locale } from "../lib/i18n/locale";

/**
 * Every component that reads useLocale() needs a LocaleProvider ancestor
 * (it throws otherwise, same as ThemeProvider/DashboardStatusProvider's own
 * "must be used within a Provider" guards) - this is the shared wrapper so
 * each test file doesn't hand-roll the same `<LocaleProvider>` JSX. Setting
 * `document.documentElement.lang` before rendering exercises the same path
 * LocaleProvider uses in production (it reads the DOM attribute the
 * anti-flash script already applied) rather than a separate test-only
 * initialization branch.
 */
export function renderWithLocale(ui: ReactElement, options?: { locale?: Locale }): RenderResult {
  if (options?.locale) {
    document.documentElement.setAttribute("lang", options.locale);
  }
  return render(<LocaleProvider>{ui}</LocaleProvider>);
}
