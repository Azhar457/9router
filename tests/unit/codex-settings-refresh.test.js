import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readSource = (relativePath) =>
  readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("Codex settings refresh", () => {
  it("bypasses cached status after applying a selected endpoint", async () => {
    const [routeSource, cardSource] = await Promise.all([
      readSource("../../src/app/api/cli-tools/codex-settings/route.js"),
      readSource("../../src/app/(dashboard)/dashboard/cli-tools/components/CodexToolCard.js"),
    ]);

    // Route Handlers already run on the server; a Server Action directive would reject this export.
    expect(routeSource).not.toContain('"use server";');
    expect(routeSource).toContain('export const dynamic = "force-dynamic";');
    // Formatting-agnostic: the fork wraps dashboard setState calls in
    // queueMicrotask (set-state-in-effect lint rule), so don't pin exact lines.
    expect(cardSource).toContain('"/api/cli-tools/codex-settings"');
    expect(cardSource.slice(
      cardSource.indexOf('"/api/cli-tools/codex-settings"'),
      cardSource.indexOf('"/api/cli-tools/codex-settings"') + 200,
    )).toMatch(/cache: "no-store"/s);
    expect(cardSource).toContain("setSelectedApiKey(apiKey));");
    expect(cardSource).toContain("setCustomBaseUrl(baseUrl));");
  });

  it("keeps an unmatched active URL in the custom endpoint slot", async () => {
    const selectorSource = await readSource("../../src/app/(dashboard)/dashboard/cli-tools/components/BaseUrlSelect.js");

    expect(selectorSource).toContain("if (current) {");
    // queueMicrotask-wrapped in the fork (set-state-in-effect lint rule)
    expect(selectorSource).toContain("setCustomInput(current));");
    expect(selectorSource).toContain("onChange(current);");
  });
});
