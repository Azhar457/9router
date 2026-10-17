import { NextResponse } from "next/server";
import { getProviderNodeById, updateProviderNode, getProviderConnections, updateProviderConnection } from "@/models";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import { deriveBaseUrl } from "@/shared/utils/deriveBaseUrl";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

// POST /api/provider-nodes/[id]/import-config
// Accepts { from: "<builtin-provider-id>" }. Merges the built-in provider's media
// serviceKinds into the node; updates the node's baseUrl to the derived media base
// URL when the node's current baseUrl is empty or the default OpenAI URL.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { from } = body;

    if (!from || typeof from !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'from' parameter" }, { status: 400 });
    }

    const source = AI_PROVIDERS[from];
    if (!source) {
      return NextResponse.json({ error: `Unknown built-in provider: ${from}` }, { status: 404 });
    }

    const node = await getProviderNodeById(id);
    if (!node) {
      return NextResponse.json({ error: "Provider node not found" }, { status: 404 });
    }

    // Build the merged serviceKinds set (preserve existing, add source media kinds)
    const existing = Array.isArray(node.serviceKinds) ? node.serviceKinds : [];
    const merged = new Set(existing);
    for (const k of source.serviceKinds || []) {
      if (k !== "llm") merged.add(k);
    }
    const serviceKinds = [...merged];

    // Update baseUrl only when it is empty or the default OpenAI URL
    const currentBaseUrl = (node.baseUrl || "").trim();
    let baseUrl = currentBaseUrl;
    let baseUrlsUpdated = false;

    const derivedImageBase = source.imageConfig?.baseUrl ? deriveBaseUrl(source.imageConfig.baseUrl) : "";
    const derivedVideoBase = source.videoConfig?.baseUrl ? deriveBaseUrl(source.videoConfig.baseUrl) : "";
    const derivedBase = derivedImageBase || derivedVideoBase;

    if (derivedBase && (!currentBaseUrl || currentBaseUrl === DEFAULT_OPENAI_BASE_URL)) {
      baseUrl = derivedBase;
      baseUrlsUpdated = true;
    }

    const updates = { serviceKinds };
    if (baseUrlsUpdated) updates.baseUrl = baseUrl;

    const updated = await updateProviderNode(id, updates);

    // Propagate the new baseUrl to active connections so runtime adapters see it
    if (baseUrlsUpdated) {
      const connections = await getProviderConnections({ provider: id });
      await Promise.all(
        connections.map((c) =>
          updateProviderConnection(c.id, {
            providerSpecificData: {
              ...(c.providerSpecificData || {}),
              baseUrl,
            },
          })
        )
      );
    }

    return NextResponse.json({ ok: true, serviceKinds, baseUrl: updated.baseUrl, baseUrlsUpdated });
  } catch (error) {
    console.log("Error importing provider config:", error);
    return NextResponse.json({ error: "Failed to import provider config" }, { status: 500 });
  }
}
