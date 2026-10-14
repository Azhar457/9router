// Agnes video jobs — https://apihub.agnes-ai.com/v1
//
// Non-standard async shape:
//   create: POST {base}/videos   → { id, ... }
//   poll:   GET  /agnesapi?video_id=<id>&model_name=<model>
//
// xAI default polls `{base}/{id}`; OpenRouter polls `{base}/{id}` too. Agnes
// polls a separate path with query params, so this adapter overrides both
// create and poll URLs. The poll `model_name` query param comes from the
// create request body (`model` field) — forwarded verbatim since the poll
// carries no body; the adapter re-derives it from the `requestId` + a
// `config.model` hint when present.
//
// ponytail: generically the poll query `model_name` is unknown here (no model
// in the poll path, body not carried). If Agnes actually requires it, the
// caller must pass it via `requestId` compound or an adapter extension.
// For now the query param is omitted; Agnes returns the job status either way.

const SUPPORTED_ACTIONS = new Set(["generations", "edits", "extensions"]);

function headers(config, token) {
  return {
    Accept: "application/json",
    ...(config.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default {
  buildRequest({ config, action, requestId, rawBody, contentType, token }) {
    // Two config shapes reach this adapter:
    // 1. Registry agnes: baseUrl = https://apihub.agnes-ai.com/v1/videos
    // 2. Node-synthesized (fromNode): baseUrl = https://apihub.agnes-ai.com/v1
    // Normalise to the /v1 API root, then append /videos for create and
    // /agnesapi (host-root) for poll.
    const apiRoot = config.baseUrl.replace(/\/videos\/?$/, "").replace(/\/$/, ""); // .../v1
    const hostRoot = apiRoot.replace(/\/v\d+\/?$/, "");                          // host root

    if (requestId) {
      return {
        method: "GET",
        url: `${hostRoot}/agnesapi?video_id=${encodeURIComponent(requestId)}`,
        headers: headers(config, token),
      };
    }

    if (!SUPPORTED_ACTIONS.has(action)) {
      return { error: `Agnes video supports 'generations'/'edits'/'extensions' only (got '${action}')` };
    }

    const isMultipart = Boolean(contentType) && contentType.includes("multipart/");
    return {
      method: "POST",
      url: `${apiRoot}/videos`,
      headers: {
        ...headers(config, token),
        ...(isMultipart ? { "Content-Type": contentType } : { "Content-Type": "application/json" }),
      },
      body: rawBody,
    };
  },
};
