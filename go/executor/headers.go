package executor

import (
	"net/http"
	"strings"
)

// BuildHeaders ports base.js buildHeaders() for the compat-node path.
// Auth: openai-compatible → Authorization: Bearer <apiKey>;
//
//	anthropic-compatible → x-api-key: <apiKey> (+ anthropic-version).
//
// Accept: text/event-stream when streaming.
func BuildHeaders(creds *Credentials, stream bool) http.Header {
	h := http.Header{}
	h.Set("Content-Type", "application/json")
	if stream {
		h.Set("Accept", "text/event-stream")
	}

	if creds == nil {
		return h
	}

	switch {
	case strings.HasPrefix(creds.Provider, "anthropic-compatible-"):
		if creds.APIKey != "" {
			h.Set("x-api-key", creds.APIKey)
		}
		if h.Get("anthropic-version") == "" {
			h.Set("anthropic-version", "2023-06-01")
		}
	default:
		// openai-compatible-* and everything else → Bearer.
		// JS legacy behavior always sets the header even when the key is
		// empty ("Bearer undefined"); Go http will send "Bearer " which is
		// harmless — keep it set for parity.
		h.Set("Authorization", "Bearer "+creds.APIKey)
	}

	return h
}
