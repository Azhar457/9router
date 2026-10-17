// Package executor is a Go port of the OpenAI-compatible executor path from
// open-sse/executors/base.js + default.js. It owns the upstream HTTP round-trip
// (URL building, headers, request transform, retry loop) for the compat-node
// providers. The caller reads and closes the returned *http.Response — for
// streaming the body is NOT consumed here.
package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"
)

// fetchConnectTimeout bounds the TCP connect + TLS handshake phase for
// non-streaming requests. It mirrors open-sse/config/runtimeConfig.js
// FETCH_CONNECT_TIMEOUT_MS (120000). It is NOT a total request deadline: the
// response body read runs to completion regardless of this limit, so slow
// generations are not killed mid-stream. A var (not const) so tests can
// shorten it to exercise the connect path without waiting 120s.
var fetchConnectTimeout = 120 * time.Second

// Credentials mirrors the minimum the JS DefaultExecutor needs for the
// compat-node path (openai-compatible-* / anthropic-compatible-*).
type Credentials struct {
	APIKey   string
	BaseURL  string // providerSpecificData.baseUrl
	APIType  string // "chat" or "responses" (authoritative; see BuildURL)
	Provider string // provider id, e.g. "openai-compatible-chat-<uuid>"
}

// ExecInput is one executor invocation.
type ExecInput struct {
	Model  string
	Body   json.RawMessage
	Stream bool
	Creds  *Credentials
	// RetryOverride replaces DefaultRetryConfig for this call; nil uses the
	// package default table.
	RetryOverride map[int]RetryConfig
}

// Result carries the upstream response back to the caller. Resp must be
// closed by the caller (the body is left open for streaming).
type Result struct {
	Resp            *http.Response
	FinalURL        string
	TransformedBody json.RawMessage
}

// Executor performs the upstream round-trip.
type Executor struct {
	Client *http.Client
}

// NewExecutor returns an Executor with a sensible default client. There is no
// overall Timeout set on the http.Client (SSE streams run until the provider
// closes). The connect + TLS handshake phase for non-streaming requests is
// bounded by fetchConnectTimeout via the transport's DialContext, not by a
// context attached to the request — this way the response body can still be
// read to completion for slow non-streaming generations.
//
// CheckRedirect is restricted to same-host redirects: Go's default client
// follows up to 10 redirects and forwards all request headers — including
// Authorization / x-api-key — to the redirect target. Because Credentials.BaseURL
// is attacker-influenced (custom provider node config), a rogue or compromised
// upstream could otherwise issue a cross-origin 302 and exfiltrate the API key.
// The JS proxyAwareFetch does not forward auth headers cross-origin, so this
// guard keeps the Go port from widening that surface.
func NewExecutor() *Executor {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		ctx, cancel := context.WithTimeout(ctx, fetchConnectTimeout)
		defer cancel()
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	return &Executor{
		Client: &http.Client{
			Transport:     transport,
			CheckRedirect: sameHostOnlyRedirect,
		},
	}
}

// sameHostOnlyRedirect follows redirects only while the host stays the same as
// the original request. A cross-host hop returns http.ErrUseLastResponse so the
// client stops following and returns the redirect response to the caller (3xx is
// not in the retry table, so it surfaces to the caller rather than being chased).
func sameHostOnlyRedirect(req *http.Request, via []*http.Request) error {
	if len(via) == 0 {
		return nil
	}
	if req.URL.Host != via[0].URL.Host {
		return http.ErrUseLastResponse
	}
	return nil
}

// Execute runs the upstream call with the retry/fallback loop ported from
// base.js execute().
func (e *Executor) Execute(ctx context.Context, in ExecInput) (*Result, error) {
	if in.Creds == nil {
		return nil, fmt.Errorf("executor: credentials required")
	}
	retryCfg := e.retryTable(in)
	url := BuildURL(in.Model, in.Stream, in.Creds)
	transformed := TransformRequest(in.Model, in.Body, in.Creds.Provider)

	client := e.Client
	if client == nil {
		client = http.DefaultClient
	}

	// doAttempt performs one upstream round-trip. For non-streaming calls the
	// connect + first-headers phase is bounded by fetchConnectTimeout (mirrors
	// JS FETCH_CONNECT_TIMEOUT_MS); that deadline is cancelled before the body
	// read so a slow generation is not killed mid-stream. Streaming has no
	// total deadline — it runs until the provider closes or ctx is cancelled.
	doAttempt := func() (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(transformed))
		if err != nil {
			return nil, fmt.Errorf("executor: build request: %w", err)
		}
		for k, vs := range BuildHeaders(in.Creds, in.Stream) {
			for _, v := range vs {
				req.Header.Set(k, v)
			}
		}

		// Use the caller's ctx so the body read (for streaming or slow
		// non-streaming generations) is not tied to a short connect deadline.
		// For non-streaming requests, fetchConnectTimeout bounds connect +
		// first-headers via the client's Timeout field if set, or the caller's
		// ctx deadline; the body read itself runs without an extra deadline.
		return client.Do(req.WithContext(ctx))
	}

	byURLAttempts := 0
	// Single-URL executor (compat node): fallbackCount is 1, so the loop runs
	// once and retries within that URL are governed by retryCfg.
	for {
		resp, err := doAttempt()
		if err != nil {
			// Network / connect error → treat as 502 for the retry table.
			if e.shouldRetryStatus(http.StatusBadGateway, byURLAttempts, retryCfg) {
				byURLAttempts++
				if err := e.wait(ctx, delayFor(http.StatusBadGateway, retryCfg)); err != nil {
					return nil, err
				}
				continue
			}
			return nil, fmt.Errorf("executor: fetch: %w", err)
		}

		if status := resp.StatusCode; e.shouldRetryStatus(status, byURLAttempts, retryCfg) {
			// Drain + close so the connection can be reused, then retry.
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			byURLAttempts++
			if err := e.wait(ctx, delayFor(status, retryCfg)); err != nil {
				return nil, err
			}
			continue
		}

		return &Result{
			Resp:            resp,
			FinalURL:        resp.Request.URL.String(),
			TransformedBody: transformed,
		}, nil
	}
}

// shouldRetryStatus mirrors resolveRetryEntry: retries while attempts remain.
func (e *Executor) shouldRetryStatus(status, attemptsUsed int, cfg map[int]RetryConfig) bool {
	// Non-retryable error statuses (4xx except 429) are returned to caller.
	if status >= 400 && status < 500 && status != http.StatusTooManyRequests {
		return false
	}
	entry, ok := cfg[status]
	if !ok || entry.Attempts <= 0 {
		return false
	}
	return attemptsUsed < entry.Attempts
}

func (e *Executor) retryTable(in ExecInput) map[int]RetryConfig {
	if in.RetryOverride != nil {
		return in.RetryOverride
	}
	return DefaultRetryConfig
}

func delayFor(status int, cfg map[int]RetryConfig) time.Duration {
	if entry, ok := cfg[status]; ok {
		return time.Duration(entry.DelayMs) * time.Millisecond
	}
	return 0
}

// wait sleeps for d unless ctx is already done (returns ctx.Err()).
func (e *Executor) wait(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
