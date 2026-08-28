"use client";

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

/**
 * BYOK section: Settings -> AI Provider. Anthropic only today
 * (AI_PROVIDER_NAMES is a real enum in @dyo/schemas, not a boolean, so
 * OpenAI/Gemini are a future enum-value addition, never a shape change).
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
  }

  return (
    <Card>
      <CardHeader title={t.settings.aiProvider.title} />
      <p>{t.settings.aiProvider.description}</p>

      {isLoading ? (
        <Skeleton height="1.5rem" />
      ) : loadError ? (
        <ErrorState title={t.settings.aiProvider.loadFailedTitle} description={loadError} />
      ) : (
        <>
          <dl className="detail-list">
            <div className="detail-list__row">
              <dt className="detail-list__label">{t.settings.aiProvider.statusLabel}</dt>
              <dd className="detail-list__value">
                {status?.connected && status.last4
                  ? t.settings.aiProvider.statusConnected(status.last4)
                  : t.settings.aiProvider.statusNotConnected}
              </dd>
            </div>
            {status?.connected && status.model ? (
              <div className="detail-list__row">
                <dt className="detail-list__label">{t.settings.aiProvider.modelLabel}</dt>
                <dd className="detail-list__value">{status.model}</dd>
              </div>
            ) : null}
            {status?.connected && status.lastVerifiedAt ? (
              <div className="detail-list__row">
                <dt className="detail-list__label" />
                <dd className="detail-list__value">{t.settings.aiProvider.lastVerifiedLabel(new Date(status.lastVerifiedAt).toLocaleString())}</dd>
              </div>
            ) : null}
          </dl>

          <Field label={t.settings.aiProvider.providerLabel} htmlFor="ai-provider-name">
            <Input id="ai-provider-name" value={t.settings.aiProvider.providerValue} disabled readOnly />
          </Field>

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

          {testResult ? (
            testResult.ok ? (
              <p role="status">{testResult.message}</p>
            ) : (
              <ErrorState title={t.settings.aiProvider.testFailedTitle} description={testResult.message} />
            )
          ) : null}
          {saveError ? <ErrorState title={t.settings.aiProvider.saveFailedTitle} description={saveError} /> : null}
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
        </>
      )}
    </Card>
  );
}
