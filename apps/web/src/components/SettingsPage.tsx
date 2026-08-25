"use client";

import type { UserDto } from "@dyo/schemas";
import { useState, type ReactElement } from "react";
import { useTheme } from "./ThemeProvider";
import { LanguageToggle } from "./LanguageToggle";
import { useLocale } from "./LocaleProvider";
import { Card, CardHeader } from "./ui/Card";
import { PageHeader } from "./ui/PageHeader";
import { Button } from "./ui/Button";
import type { Theme } from "../lib/theme";

export interface SettingsPageProps {
  user: UserDto;
}

export function SettingsPage({ user }: SettingsPageProps): ReactElement {
  const { theme, isExplicit, setTheme, useSystemTheme } = useTheme();
  const { t } = useLocale();
  const [loggingOut, setLoggingOut] = useState(false);

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

      <Card>
        <CardHeader title={t.settings.apiConnection} />
        <dl className="detail-list">
          <div className="detail-list__row">
            <dt className="detail-list__label">{t.settings.controlPlaneApi}</dt>
            <dd className="detail-list__value">{t.settings.controlPlaneApiValue}</dd>
          </div>
        </dl>
        <p className="field__hint">{t.settings.apiConnectionHint}</p>
      </Card>
    </>
  );
}
