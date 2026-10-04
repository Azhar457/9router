package executor

import "net/http"

// RetryConfig mirrors the per-status retry entry from
// open-sse/config/runtimeConfig.js DEFAULT_RETRY_CONFIG.
type RetryConfig struct {
	Attempts int
	DelayMs  int
}

// DefaultRetryConfig mirrors DEFAULT_RETRY_CONFIG from runtimeConfig.js:
//
//	502: 3 attempts, 3000 ms
//	503: 3 attempts, 2000 ms
//	504: 2 attempts, 3000 ms
//
// 429 has 0 attempts by default (rate-limiting is handled by the account-
// fallback loop on the JS side, not by the executor).
var DefaultRetryConfig = map[int]RetryConfig{
	http.StatusBadGateway:         {Attempts: 3, DelayMs: 3000},
	http.StatusServiceUnavailable: {Attempts: 3, DelayMs: 2000},
	http.StatusGatewayTimeout:     {Attempts: 2, DelayMs: 3000},
}
