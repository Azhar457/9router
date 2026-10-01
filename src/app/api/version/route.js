import https from "https";
import pkg from "../../../../package.json" with { type: "json" };

// GitHub Releases is the update source of truth (npm package is deprecated).
const ghRepo = process.env.UPDATER_GH_REPO || "Azhar457/9router";
const VERSION_CACHE_TTL_MS = 3600000; // cache latest-release lookup for 1h

// Survive hot reload; one cache per process
const versionCache = (global.__ghVersionCache ??= { value: null, fetchedAt: 0 });

// Fetch latest release tag (e.g. "v0.5.96" → "0.5.96") from GitHub
function fetchLatestVersion() {
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.github.com/repos/${ghRepo}/releases/latest`,
      {
        timeout: 4000,
        headers: {
          "User-Agent": "9router-update-check",
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const tag = JSON.parse(data).tag_name || "";
            resolve(tag.replace(/^v/, "") || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

async function getLatestVersionCached() {
  if (versionCache.value && Date.now() - versionCache.fetchedAt < VERSION_CACHE_TTL_MS) {
    return versionCache.value;
  }
  const latest = await fetchLatestVersion();
  if (latest) {
    versionCache.value = latest;
    versionCache.fetchedAt = Date.now();
  }
  return latest;
}

export async function GET() {
  const latestVersion = await getLatestVersionCached();
  const currentVersion = pkg.version;
  const hasUpdate = latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false;

  return Response.json({ currentVersion, latestVersion, hasUpdate });
}
