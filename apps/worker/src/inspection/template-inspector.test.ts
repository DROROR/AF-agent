import { describe, expect, it } from "vitest";
import type { InspectTemplateRequest } from "@dyo/schemas";
import { InspectionTransportUnavailableError, NotAvailableTemplateInspector } from "./template-inspector.js";

const request: InspectTemplateRequest = { templateId: "tmpl-1", sourceProjectPath: "/copies/test.aep" };

describe("NotAvailableTemplateInspector", () => {
  it("never returns a result - always throws, never fabricating a manifest", async () => {
    const inspector = new NotAvailableTemplateInspector();
    await expect(inspector.inspect(request)).rejects.toThrow(InspectionTransportUnavailableError);
  });

  it("explains a real reason, not a generic failure", async () => {
    const inspector = new NotAvailableTemplateInspector();
    await expect(inspector.inspect(request)).rejects.toThrow(/ae-mcp transport/);
  });
});
