import { describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

/**
 * A real network call to Anthropic is never made in this test file - the
 * SDK itself is replaced so `suggest()`'s real request-building logic runs
 * (proving strict:true and the fixed schema are actually what gets sent),
 * without ever reaching the network. See section 4 of this fix's own
 * instructions for the separate, real (non-mocked) Anthropic acceptance
 * check that a mocked test like this one cannot substitute for.
 */
vi.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    status = 400;
  }
  class MockAnthropic {
    messages = { create: mockCreate };
    constructor(_options: { apiKey: string }) {}
    static APIError = MockAPIError;
  }
  return { default: MockAnthropic };
});

import { AnthropicSuggestionProvider, PROPOSAL_INPUT_SCHEMA } from "../anthropic-suggestion-provider.js";

const CLASSIFICATION_VALUES = ["image", "video", "text", "logo", "phone_screen", "color", "unknown"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Real production bug, 2026-08-30: Anthropic's strict tool-schema
 * validator (this tool is registered with strict: true) rejected the
 * ordinary JSON-Schema "type: [X, 'null']" + "enum" combination for a
 * nullable enum with a 400 invalid_request_error - proven against the
 * real API in production, not something the existing Zod/domain tests
 * could ever catch, since they never exercise Anthropic's own schema
 * acceptance rules. A second, previously-hidden instance of the same
 * class of problem (minimum/maximum on a `number` type) was found while
 * proving this fix against the real Anthropic API (see this fix's own
 * smoke test) and fixed the same way: the JSON-Schema hint was dropped
 * from the LLM-facing schema, while the real [0,1] bound stays fully
 * enforced at the domain layer (aiSuggestionProposalSchema.confidence in
 * @dyo/schemas), completely independent of what hint Anthropic accepts.
 * These tests assert on the real JSON Schema object this provider sends,
 * so a regression to either invalid shape (or a new field introducing
 * either pattern) fails a test before it ever reaches production again.
 */
describe("AnthropicSuggestionProvider - PROPOSAL_INPUT_SCHEMA (Anthropic strict-schema fix)", () => {
  const itemProps = PROPOSAL_INPUT_SCHEMA.properties.proposals.items.properties;
  const classificationSchema = itemProps.suggestedClassification;

  it("no longer uses the invalid type-array + enum combination for suggestedClassification", () => {
    expect(classificationSchema).not.toHaveProperty("type");
    expect(classificationSchema).not.toHaveProperty("enum");
  });

  it("uses anyOf(string-with-enum, null) instead - the form Anthropic's strict validator accepts", () => {
    expect(classificationSchema.anyOf).toEqual([
      { type: "string", enum: [...CLASSIFICATION_VALUES] },
      { type: "null" }
    ]);
  });

  it("still describes exactly the same real classification values as before this fix - none added, none removed", () => {
    const [stringBranch] = classificationSchema.anyOf;
    expect(stringBranch.enum).toEqual([...CLASSIFICATION_VALUES]);
  });

  it("every other nullable field's plain type-array pattern is untouched (description-only guidance added separately) - only suggestedClassification's invalid enum combination was fixed", () => {
    expect(itemProps.mappingId).toMatchObject({ type: ["string", "null"] });
    expect(itemProps.suggestedAssetId).toMatchObject({ type: ["string", "null"] });
    expect(itemProps.suggestedText).toEqual({ type: ["string", "null"] });
    expect(itemProps.suggestedAssetTimestamp).toMatchObject({ type: ["number", "null"] });
    expect(itemProps.suggestedFinalDuration).toMatchObject({ type: ["number", "null"] });
    expect(itemProps.reasoning).toMatchObject({ type: ["string", "null"] });
  });

  it("carries guidance-only `description` text (never an enforced constraint) steering the model away from the exact values that caused real domain-validation rejections - empty strings and out-of-range numbers", () => {
    expect(itemProps.mappingId.description).toMatch(/never an empty string/i);
    expect(itemProps.suggestedAssetId.description).toMatch(/never an empty string/i);
    expect(itemProps.reasoning.description).toMatch(/never an empty string/i);
    expect(itemProps.confidence.description).toMatch(/0 through 1/i);
    expect(itemProps.suggestedFinalDuration.description).toMatch(/positive/i);
    expect(itemProps.suggestedAssetTimestamp.description).toMatch(/non-negative/i);
  });

  it("no field anywhere in the tool schema combines an array `type` with `enum` - the exact invalid pattern that broke production", () => {
    function assertNoInvalidCombination(node: unknown): void {
      if (!isRecord(node)) {
        return;
      }
      if (Array.isArray(node.type) && "enum" in node) {
        throw new Error(`Found an invalid type-array + enum combination: ${JSON.stringify(node)}`);
      }
      for (const value of Object.values(node)) {
        assertNoInvalidCombination(value);
      }
    }
    expect(() => assertNoInvalidCombination(PROPOSAL_INPUT_SCHEMA)).not.toThrow();
  });

  it("confidence no longer declares minimum/maximum - Anthropic's strict validator rejects those on a number type too", () => {
    expect(itemProps.confidence).not.toHaveProperty("minimum");
    expect(itemProps.confidence).not.toHaveProperty("maximum");
    expect(itemProps.confidence.type).toBe("number");
  });

  it("no `number`-typed field anywhere in the tool schema declares minimum/maximum - the second invalid pattern this fix found and removed", () => {
    function assertNoNumberBounds(node: unknown): void {
      if (!isRecord(node)) {
        return;
      }
      if (node.type === "number" && ("minimum" in node || "maximum" in node)) {
        throw new Error(`Found a number field with minimum/maximum: ${JSON.stringify(node)}`);
      }
      for (const value of Object.values(node)) {
        assertNoNumberBounds(value);
      }
    }
    expect(() => assertNoNumberBounds(PROPOSAL_INPUT_SCHEMA)).not.toThrow();
  });
});

function bundleFixture() {
  return {
    scenePlanId: "scene-1",
    manifestCompositionId: "comp-1",
    compositionName: "Scene 01",
    sourcePosition: 0,
    mappingId: "mapping-1",
    manifestPlaceholderId: "ph-1",
    placeholderName: "Hero Image",
    currentClassification: null,
    sceneEvidence: null,
    workMapEntry: null,
    candidateAssets: [],
    userInstructions: null,
    brandInputs: null
  };
}

describe("AnthropicSuggestionProvider.suggest() - real request shape sent to the SDK (mocked network)", () => {
  it("still registers the tool with strict:true - this fix only changed the schema shape, never disabled strict mode", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    await provider.suggest([bundleFixture()]);

    const [request] = mockCreate.mock.calls[0] as [{ tools: [{ strict: boolean; input_schema: unknown }] }];
    expect(request.tools[0].strict).toBe(true);
  });

  it("sends the exact fixed PROPOSAL_INPUT_SCHEMA as the tool's input_schema - no drift between what tests inspect and what the real request carries", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    await provider.suggest([bundleFixture()]);

    const [request] = mockCreate.mock.calls[0] as [{ tools: [{ input_schema: unknown }] }];
    expect(request.tools[0].input_schema).toEqual(PROPOSAL_INPUT_SCHEMA);
  });

  it("still returns the tool_use input verbatim under .proposals - the provider output contract for proposals is unchanged by this schema-shape fix", async () => {
    const rawProposals = { proposals: [{ scenePlanId: "scene-1" }] };
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: rawProposals }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    const result = await provider.suggest([bundleFixture()]);

    expect(result.proposals).toEqual(rawProposals);
  });

  it("still requests max_tokens: 8000 - observability-only additions never change generation behavior", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    await provider.suggest([bundleFixture()]);

    const [request] = mockCreate.mock.calls[0] as [{ max_tokens: number }];
    expect(request.max_tokens).toBe(8000);
  });
});

/**
 * Real production bug, 2026-08-30: a real ~62s Anthropic call for a
 * 106-target project returned zero raw proposals - a legitimate empty
 * result under the existing rule, but with no way to tell a clean
 * "nothing to propose" apart from a MAX_TOKENS truncation. These tests
 * prove the provider now captures and returns that distinguishing
 * metadata (stop_reason, input/output token counts) - never the response
 * content itself - so the next real occurrence is diagnosable from logs
 * alone, without calling Anthropic again.
 */
describe("AnthropicSuggestionProvider.suggest() - completion metadata (observability only, 2026-08-30)", () => {
  it("captures the real stop_reason and input/output token counts from the response", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "max_tokens",
      usage: { input_tokens: 12345, output_tokens: 8000 },
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    const result = await provider.suggest([bundleFixture()]);

    expect(result.metadata).toEqual({ stopReason: "max_tokens", inputTokens: 12345, outputTokens: 8000 });
  });

  it("captures a genuine end_turn/tool_use stop_reason just as faithfully - never assumes or fabricates truncation", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      usage: { input_tokens: 500, output_tokens: 300 },
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    const result = await provider.suggest([bundleFixture()]);

    expect(result.metadata.stopReason).toBe("tool_use");
  });

  it("handles a response with no usage field safely - token counts fall back to null, never thrown or fabricated", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    const result = await provider.suggest([bundleFixture()]);

    expect(result.metadata).toEqual({ stopReason: "tool_use", inputTokens: null, outputTokens: null });
  });

  it("never logs/exposes the raw response content or tool input as part of metadata - metadata is exactly {stopReason, inputTokens, outputTokens}, nothing else", async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      usage: { input_tokens: 1, output_tokens: 2 },
      content: [{ type: "tool_use", name: "propose_mapping_suggestions", input: { proposals: [{ scenePlanId: "secret-scene" }] } }]
    });
    const provider = new AnthropicSuggestionProvider("fake-api-key", "claude-sonnet-5");
    const result = await provider.suggest([bundleFixture()]);

    expect(Object.keys(result.metadata).sort()).toEqual(["inputTokens", "outputTokens", "stopReason"]);
    expect(JSON.stringify(result.metadata)).not.toContain("secret-scene");
  });
});
