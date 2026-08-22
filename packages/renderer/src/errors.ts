/**
 * Typed error hierarchy for the renderer abstraction - mirrors the pattern
 * used in apps/api and apps/worker (docs/engineering/ERROR_HANDLING.md).
 * Nothing here is thrown as a raw string.
 */
export abstract class RendererError extends Error {
  abstract readonly category: string;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Missing/invalid provider configuration (e.g. an unset API key, an unknown provider name). */
export class RendererConfigError extends RendererError {
  readonly category = "config";
}

/**
 * A contract method a provider genuinely does not implement in this
 * environment - see AfterEffectsRenderer, which requires the real Windows
 * worker/After Effects machine (CLAUDE.md Phase 4 blocker). Never fabricate
 * a result instead of throwing this.
 */
export class RendererNotImplementedError extends RendererError {
  readonly category = "not-implemented";

  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
  }
}

/** The provider's remote API was reachable but returned an error/unexpected response. */
export class RendererRequestError extends RendererError {
  readonly category = "infrastructure";
  readonly statusCode: number;

  constructor(message: string, statusCode: number, options?: { cause?: unknown }) {
    super(message, options);
    this.statusCode = statusCode;
  }
}

/** The provider's remote API could not be reached at all (DNS/connect/timeout). */
export class RendererNetworkError extends RendererError {
  readonly category = "network";
}
