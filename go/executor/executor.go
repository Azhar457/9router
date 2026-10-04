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
	"net/http"
	"time"
)

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

// NewExecutor returns an Executor with a sensible default client (no timeout —
// SSE streams run until the provider closes; connect timeout is applied per
// request via context).
func NewExecutor() *Executor {
	return &Executor{
		Client: &http.Client{
			Timeout: 0, // streaming: no overall deadline; per-attempt ctx governs
		},
	}
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

	byURLAttempts := 0
	// Single-URL executor (compat node): fallbackCount is 1, so the loop runs
	// once and retries within that URL are governed by retryCfg.
	for {
		attemptCtx := ctx
		if !in.Stream {
			// JSON responses get a generous deadline; streaming runs until ctx
			// or the provider closes.
			var cancel context.CancelFunc
			attemptCtx, cancel = context.WithTimeout(ctx, 120*time.Second)
			defer cancel()
		}

		req, err := http.NewRequestWithContext(attemptCtx, http.MethodPost, url, bytes.NewReader(transformed))
		if err != nil {
			return nil, fmt.Errorf("executor: build request: %w", err)
		}
		for k, vs := range BuildHeaders(in.Creds, in.Stream) {
			for _, v := range vs {
				req.Header.Set(k, v)
			}
		}

		resp, err := client.Do(req)
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
