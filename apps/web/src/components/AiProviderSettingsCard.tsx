"use client";

import { Bot } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import { ANTHROPIC_MODELS, DEFAULT_ANTHROPIC_MODEL, type AiProviderStatus, type AnthropicModel } from "@dyo/schemas";
import { Card, CardHeader } from "./ui/Card";
import { Field } from "./ui/Field";
import { Input } from "./ui/Input";
import { Select } from "./ui/Select";
import { Button } from "./ui/Button";
import { ErrorState } from "./ErrorState";
import { Skeleton } from "./ui/Skeleton";
import { useLocale } from "./LocaleProvider";
import { connectAiProvider, disconnectAiProvider, fetchAiProviderStatus, testAiProviderConnection } from "../lib/ai-provider-api-client";

type ProviderBadgeTone = "positive" | "neutral" | "negative";

/**
 * BYOK section: Settings -> AI Providers. Anthropic only today
 * (AI_PROVIDER_NAMES is a real enum in @dyo/schemas, not a boolean, so
 * OpenAI/Gemini are a future enum-value addition, never a shape change) -
 * they're listed below as disabled "coming soon" rows, never as a fake
 * "Connected" card, since neither is actually implemented yet.
 *
 * The raw API key lives ONLY in this component's own local state, for the
 * duration of typing it in and clicking Test/Save - it is never written to
 * localStorage/sessionStorage, never logged, and the GET status response
 * this card reads on mount (aiProviderStatusSchema) never carries it back,
 * only a masked `last4`. See routes/user-ai-provider.ts's own doc comment
 * on the server side of that same guarantee.
 */
export function AiProviderSettingsCard(): ReactElement {
  const { t } = useLocale();
  const [status, setStatus] = useState<AiProviderStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState<AnthropicModel>(DEFAULT_ANTHROPIC_MODEL);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAiProviderStatus().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setStatus(result.data);
        setLoadError(null);
        // Not-yet-connected opens the manage form immediately (nothing to
        // review yet); an already-connected provider stays collapsed to a
        // summary until the user explicitly asks to manage it.
        setManageOpen(!result.data.connected);
      } else {
        setLoadError(result.message);
      }
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = apiKey.trim().length >= 20;
  const badgeTone: ProviderBadgeTone = loadError ? "negative" : status?.connected ? "positive" : "neutral";
  const badgeLabel = loadError ? t.settings.aiProvider.badgeError : status?.connected ? t.settings.aiProvider.badgeConnected : t.settings.aiProvider.badgeNotConnected;

  async function handleTest(): Promise<void> {
    setIsTesting(true);
    setTestResult(null);
    const result = await testAiProviderConnection({ provider: "ANTHROPIC", apiKey: apiKey.trim(), model });
    setIsTesting(false);
    if (!result.ok) {
      setTestResult({ ok: false, message: result.message });
      return;
    }
    setTestResult(result.data.ok ? { ok: true, message: t.settings.aiProvider.testSucceeded } : { ok: false, message: result.data.reason ?? "" });
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setSaveError(null);
    const result = await connectAiProvider({ provider: "ANTHROPIC", apiKey: apiKey.trim(), model });
    setIsSaving(false);
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setStatus(result.data);
    setApiKey("");
    setTestResult(null);
    setManageOpen(false);
  }

  async function handleDisconnect(): Promise<void> {
    setIsDisconnecting(true);
    setDisconnectError(null);
    const result = await disconnectAiProvider();
    setIsDisconnecting(false);
    if (!result.ok) {
      setDisconnectError(result.message);
      return;
    }
    setStatus({ connected: false, provider: null, model: null, last4: null, lastVerifiedAt: null });
    setApiKey("");
    setTestResult(null);
    setManageOpen(true);
  }

  return (
    <Card className="card--glass">
      <CardHeader title={t.settings.aiProvider.title} />
      <p>{t.settings.aiProvider.description}</p>

      {isLoading ? (
        <Skeleton height="3rem" />
      ) : (
        <>
          {loadError ? <ErrorState title={t.settings.aiProvider.loadFailedTitle} description={loadError} /> : null}

          <div className="provider-row">
            <span className="provider-row__icon">
              <Bot aria-hidden="true" size={22} />
            </span>
            <div className="provider-row__info">
              <p className="provider-row__name">{t.settings.aiProvider.anthropicName}</p>
              <p className="provider-row__meta">{t.settings.aiProvider.anthropicModelsSummary}</p>
              {status?.connected && status.model ? (
                <p className="provider-row__meta">
                  {t.settings.aiProvider.selectedModelLabel}: {status.model}
                </p>
              ) : null}
              {status?.connected && status.lastVerifiedAt ? (
                <p className="provider-row__meta">{t.settings.aiProvider.lastVerifiedLabel(new Date(status.lastVerifiedAt).toLocaleString())}</p>
              ) : null}
            </div>
            <span className={`status-badge status-badge--${badgeTone}`}>{badgeLabel}</span>
            <Button size="sm" variant="secondary" onClick={() => setManageOpen((open) => !open)}>
              {manageOpen ? t.settings.aiProvider.collapseAction : status?.connected ? t.settings.aiProvider.manageAction : t.settings.aiProvider.connectAction}
            </Button>
          </div>

          {manageOpen ? (
            <div className="provider-manage">
              <Field label={t.settings.aiProvider.apiKeyLabel} htmlFor="ai-provider-api-key">
                <Input
                  id="ai-provider-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={t.settings.aiProvider.apiKeyPlaceholder}
                  value={apiKey}
                  disabled={isTesting || isSaving}
                  onChange={(event) => {
                    setApiKey(event.target.value);
                    setTestResult(null);
                  }}
                />
              </Field>

              <Field label={t.settings.aiProvider.modelLabel} htmlFor="ai-provider-model">
                <Select id="ai-provider-model" value={model} disabled={isTesting || isSaving} onChange={(event) => setModel(event.target.value as AnthropicModel)}>
                  {ANTHROPIC_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>

              {status?.connected && status.last4 ? <p className="field__hint">{t.settings.aiProvider.statusConnected(status.last4)}</p> : null}

              {testResult ? (
                testResult.ok ? (
                  <p role="status">{testResult.message}</p>
                ) : (
                  <ErrorState title={t.settings.aiProvider.connectionFailedTitle} description={testResult.message} />
                )
              ) : null}
              {saveError ? <ErrorState title={t.settings.aiProvider.connectionFailedTitle} description={saveError} /> : null}
              {disconnectError ? <ErrorState title={t.settings.aiProvider.disconnectFailedTitle} description={disconnectError} /> : null}

              <div className="overview-actions">
                <Button variant="secondary" disabled={!canSubmit || isTesting || isSaving} onClick={() => void handleTest()}>
                  {isTesting ? t.settings.aiProvider.testing : t.settings.aiProvider.testAction}
                </Button>
                <Button variant="primary" disabled={!canSubmit || isTesting || isSaving} onClick={() => void handleSave()}>
                  {isSaving ? t.settings.aiProvider.saving : status?.connected ? t.settings.aiProvider.replaceAction : t.settings.aiProvider.saveAction}
                </Button>
                {status?.connected ? (
                  <Button variant="ghost" disabled={isDisconnecting} onClick={() => void handleDisconnect()}>
                    {isDisconnecting ? t.settings.aiProvider.disconnecting : t.settings.aiProvider.disconnectAction}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="provider-row provider-row--disabled">
            <span className="provider-row__icon">
              <Bot aria-hidden="true" size={22} />
            </span>
            <div className="provider-row__info">
              <p className="provider-row__name">{t.settings.aiProvider.comingSoonName("OpenAI")}</p>
            </div>
          </div>
          <div className="provider-row provider-row--disabled">
            <span className="provider-row__icon">
              <Bot aria-hidden="true" size={22} />
            </span>
            <div className="provider-row__info">
              <p className="provider-row__name">{t.settings.aiProvider.comingSoonName("Google Gemini")}</p>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
