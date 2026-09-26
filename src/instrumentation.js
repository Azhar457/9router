export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    const { startOmniRouteSync } = await import("@/lib/modelCatalog/omniSync.js");
    startOmniRouteSync();

    const { startProviderFreeModelSync } = await import("@/lib/modelCatalog/providerSync.js");
    startProviderFreeModelSync();
  }
}
