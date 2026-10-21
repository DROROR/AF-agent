"use client";

import type { UserDto } from "@dyo/schemas";
import { useEffect, useState, type ReactElement } from "react";
import { useTheme } from "./ThemeProvider";
import { readTechnicalScreensEnabled, writeStoredWorkspaceMode, writeTechnicalScreensEnabled } from "../lib/workspace-mode";
import { LanguageToggle } from "./LanguageToggle";
import { useLocale } from "./LocaleProvider";
import { Card, CardHeader } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { Button } from "./ui/Button";
import { AiProviderSettingsCard } from "./AiProviderSettingsCard";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../lib/settings-sections";
import type { Theme } from "../lib/theme";
import type { Dictionary } from "../lib/i18n/dictionaries";

export interface SettingsPageProps {
  user: UserDto;
}

function sectionLabel(t: Dictionary, id: SettingsSectionId): string {
  switch (id) {
    case "ai-providers":
      return t.settings.navAiProviders;
    case "appearance":
      return t.settings.navAppearance;
    case "account":
      return t.settings.navAccount;
  }
}

/**
 * Settings redesign: a 2-column layout (vertical section nav on the left,
 * selected section's content on the right) instead of one long stack of
 * cards. SETTINGS_SECTIONS only lists sections with real, working content
 * behind them (no placeholder "Security"/"General" tabs) - see that
 * file's own doc comment. Section switching is local component state, not
 * a route - nothing here needs its own URL.
 */
export function SettingsPage({ user }: SettingsPageProps): ReactElement {
  const { theme, isExplicit, setTheme, useSystemTheme } = useTheme();
  const { t } = useLocale();
  // Settings > "Technical screens" (2026-10-21): per device, read from the
  // same storage the project pages' WorkspaceModeProvider reads - that
  // provider is mounted only under a project, so Settings reads storage itself.
  const [technicalScreens, setTechnicalScreens] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function syncFromStorage(): Promise<void> {
      await Promise.resolve();
      if (!cancelled) {
        setTechnicalScreens(readTechnicalScreensEnabled());
      }
    }
    void syncFromStorage();
    return () => {
      cancelled = true;
    };
  }, []);
  function handleTechnicalScreens(enabled: boolean): void {
    setTechnicalScreens(enabled);
    writeTechnicalScreensEnabled(enabled);
    if (!enabled) {
      writeStoredWorkspaceMode("simple");
    }
  }
  const [loggingOut, setLoggingOut] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("ai-providers");

  const THEME_OPTIONS: { value: Theme; label: string }[] = [
    { value: "light", label: t.settings.themeLight },
    { value: "dark", label: t.settings.themeDark }
  ];

  const handleLogout = (): void => {
    setLoggingOut(true);
    fetch("/api/auth/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        window.location.href = "/login";
      });
  };

  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.description} />

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t.settings.title}>
          {SETTINGS_SECTIONS.map((section) => {
            const Icon = section.icon;
            const isActive = section.id === activeSection;
            return (
              <button
                key={section.id}
                type="button"
                className="settings-nav__item"
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{sectionLabel(t, section.id)}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-content">
          {activeSection === "ai-providers" ? <AiProviderSettingsCard /> : null}

          {activeSection === "appearance" ? (
            <>
              <Card>
                <CardHeader title={t.settings.appearance} />
                <div className="settings-theme-row">
                  {THEME_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      variant={isExplicit && theme === option.value ? "primary" : "secondary"}
                      onClick={() => setTheme(option.value)}
                      aria-pressed={isExplicit && theme === option.value}
                    >
                      {option.label}
                    </Button>
                  ))}
                  <Button variant={!isExplicit ? "primary" : "secondary"} onClick={useSystemTheme} aria-pressed={!isExplicit}>
                    {t.settings.matchSystem}
                  </Button>
                </div>
                <p className="field__hint">{t.settings.savedOnThisDevice}</p>
              </Card>

              <Card>
                <CardHeader title={t.settings.language} />
                <div className="settings-theme-row">
                  <LanguageToggle />
                </div>
                <p className="field__hint">{t.settings.savedOnThisDevice}</p>
              </Card>

              {/* 2026-10-21 simplification: the Advanced view is for support, offered only from here. */}
              <Card>
                <CardHeader title={t.settings.technicalScreens} />
                <label className="settings-switch" htmlFor="technical-screens">
                  <input id="technical-screens" type="checkbox" checked={technicalScreens} onChange={(event) => handleTechnicalScreens(event.target.checked)} />
                  <span>{t.settings.technicalScreens}</span>
                </label>
                <p className="field__hint">{t.settings.technicalScreensHint}</p>
                <p className="field__hint">{t.settings.savedOnThisDevice}</p>
              </Card>
            </>
          ) : null}

          {activeSection === "account" ? (
            <Card>
              <CardHeader title={t.settings.account} />
              <dl className="detail-list">
                <div className="detail-list__row">
                  <dt className="detail-list__label">{t.settings.accountNameLabel}</dt>
                  <dd className="detail-list__value">{user.name}</dd>
                </div>
                <div className="detail-list__row">
                  <dt className="detail-list__label">{t.settings.accountEmailLabel}</dt>
                  <dd className="detail-list__value">{user.email}</dd>
                </div>
                <div className="detail-list__row">
                  <dt className="detail-list__label">{t.settings.accountRoleLabel}</dt>
                  <dd className="detail-list__value">{user.role}</dd>
                </div>
              </dl>
              <Button variant="secondary" onClick={handleLogout} disabled={loggingOut}>
                {t.settings.logout}
              </Button>
            </Card>
          ) : null}

        </div>
      </div>
    </>
  );
}
