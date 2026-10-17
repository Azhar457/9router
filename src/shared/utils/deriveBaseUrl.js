/**
 * Strip media-endpoint suffixes from a config URL to get the base URL.
 *
 * @param {string} url  e.g. "https://apihub.agnes-ai.com/v1/images/generations"
 * @returns {string}    e.g. "https://apihub.agnes-ai.com/v1"
 */
export function deriveBaseUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url
    .replace(/\/images\/generations\/?$/, "")
    .replace(/\/videos\/?$/, "")
    .replace(/\/embeddings\/?$/, "")
    .replace(/\/tts\/?$/, "")
    .replace(/\/$/, "");
}
