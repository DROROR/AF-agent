import { readFile } from "node:fs/promises";
import { z } from "zod";
import { RendererNetworkError, RendererRequestError } from "../../errors.js";
import type { ShotstackConfig } from "./shotstack-env.js";

/**
 * Shotstack's Ingest API (a different base path than the Edit API used
 * elsewhere in this package) - lets a local file become a public HTTPS URL
 * usable as a clip `asset.src`. Live-verified against the real sandbox API;
 * not documented in enough detail on Shotstack's public docs to trust
 * blindly, so this was empirically confirmed end-to-end (see
 * docs/SHOTSTACK-REFERENCE-POC.md) rather than guessed:
 *
 * 1. POST {ingestBaseUrl}/upload -> { data: { id, attributes: { url } } }
 *    where `attributes.url` is a presigned S3 PUT URL (not a `/sources`
 *    call - that's for fetching an *already public* URL, a different flow).
 * 2. PUT the raw file bytes to that presigned URL.
 * 3. The same `id` from step 1 auto-registers as a source. Poll
 *    GET {ingestBaseUrl}/sources/{id} until attributes.status is "ready",
 *    then attributes.source is the final public HTTPS URL to use as
 *    asset.src in the Edit API.
 */
const INGEST_BASE_URLS = {
  sandbox: "https://api.shotstack.io/ingest/stage",
  production: "https://api.shotstack.io/ingest/v1"
} as const;

const uploadResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    attributes: z.object({ url: z.string().url() })
  })
});

const sourceResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    attributes: z.object({
      status: z.enum(["importing", "ready", "failed"]),
      source: z.string().url().optional(),
      error: z.string().optional()
    })
  })
});

const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 30; // ~1 minute

export interface UploadedAsset {
  sourceId: string;
  url: string;
}

async function requestUploadUrl(
  config: ShotstackConfig,
  fetchImpl: typeof fetch
): Promise<{ id: string; putUrl: string }> {
  let response: Response;
  try {
    response = await fetchImpl(`${INGEST_BASE_URLS[config.env]}/upload`, {
      method: "POST",
      headers: { "x-api-key": config.apiKey }
    });
  } catch (cause) {
    throw new RendererNetworkError("Failed to reach Shotstack ingest /upload", { cause });
  }
  if (!response.ok) {
    throw new RendererRequestError("Shotstack ingest /upload failed", response.status);
  }
  const json: unknown = await response.json();
  const parsed = uploadResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RendererRequestError("Unexpected Shotstack ingest /upload response shape", response.status);
  }
  return { id: parsed.data.data.id, putUrl: parsed.data.data.attributes.url };
}

async function putFile(putUrl: string, fileBytes: Buffer, fetchImpl: typeof fetch): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(putUrl, { method: "PUT", body: new Uint8Array(fileBytes) });
  } catch (cause) {
    throw new RendererNetworkError("Failed to PUT file to Shotstack's presigned upload URL", { cause });
  }
  if (!response.ok) {
    throw new RendererRequestError("Presigned upload PUT failed", response.status);
  }
}

async function pollUntilReady(
  sourceId: string,
  config: ShotstackConfig,
  fetchImpl: typeof fetch,
  pollIntervalMs: number
): Promise<string> {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    let response: Response;
    try {
      response = await fetchImpl(`${INGEST_BASE_URLS[config.env]}/sources/${sourceId}`, {
        headers: { "x-api-key": config.apiKey }
      });
    } catch (cause) {
      throw new RendererNetworkError("Failed to reach Shotstack ingest /sources/{id}", { cause });
    }
    if (!response.ok) {
      throw new RendererRequestError("Shotstack ingest /sources/{id} failed", response.status);
    }
    const json: unknown = await response.json();
    const parsed = sourceResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new RendererRequestError("Unexpected Shotstack ingest source response shape", response.status);
    }
    const { status, source, error } = parsed.data.data.attributes;
    if (status === "ready" && source) {
      return source;
    }
    if (status === "failed") {
      throw new RendererRequestError(`Shotstack ingest source failed: ${error ?? "unknown error"}`, 502);
    }
  }
  throw new RendererRequestError(
    `Shotstack ingest source ${sourceId} did not become ready after ${MAX_POLL_ATTEMPTS} polls`,
    504
  );
}

/** Uploads one local file to Shotstack sandbox/production storage and returns its final public URL, ready to use as a clip `asset.src`. */
export async function uploadAssetToShotstack(
  filePath: string,
  config: ShotstackConfig,
  fetchImpl: typeof fetch = fetch,
  pollIntervalMs: number = POLL_INTERVAL_MS
): Promise<UploadedAsset> {
  const fileBytes = await readFile(filePath);
  const { id, putUrl } = await requestUploadUrl(config, fetchImpl);
  await putFile(putUrl, fileBytes, fetchImpl);
  const url = await pollUntilReady(id, config, fetchImpl, pollIntervalMs);
  return { sourceId: id, url };
}
