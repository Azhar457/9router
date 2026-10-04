package executor

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// --- TestBuildURL -------------------------------------------------------

func TestBuildURL(t *testing.T) {
	cases := []struct {
		name   string
		creds  *Credentials
		stream bool
		want   string
	}{
		{
			name:   "openai-compatible chat",
			creds:  &Credentials{BaseURL: "http://host/v1/", Provider: "openai-compatible-chat-abc", APIType: "chat"},
			stream: false,
			want:   "http://host/v1/chat/completions",
		},
		{
			name:   "openai-compatible responses",
			creds:  &Credentials{BaseURL: "http://host/v1", Provider: "openai-compatible-responses-abc", APIType: "responses"},
			stream: true,
			want:   "http://host/v1/responses",
		},
		{
			name:   "legacy node id fallback (chat)",
			creds:  &Credentials{BaseURL: "http://host", Provider: "openai-compatible-chat-legacy", APIType: ""},
			stream: false,
			want:   "http://host/chat/completions",
		},
		{
			name:   "legacy node id fallback (responses)",
			creds:  &Credentials{BaseURL: "http://host", Provider: "openai-compatible-responses-legacy", APIType: ""},
			stream: false,
			want:   "http://host/responses",
		},
		{
			name:   "anthropic-compatible",
			creds:  &Credentials{BaseURL: "http://host", Provider: "anthropic-compatible-abc"},
			stream: true,
			want:   "http://host/messages",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := BuildURL("model", c.stream, c.creds); got != c.want {
				t.Errorf("BuildURL = %q, want %q", got, c.want)
			}
		})
	}
}

// --- TestBuildHeaders ----------------------------------------------------

func TestBuildHeaders(t *testing.T) {
	t.Run("openai-compatible Bearer", func(t *testing.T) {
		h := BuildHeaders(&Credentials{Provider: "openai-compatible-x", APIKey: "sk-test"}, false)
		if got := h.Get("Authorization"); got != "Bearer sk-test" {
			t.Errorf("Authorization = %q, want Bearer sk-test", got)
		}
		if got := h.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}
		if h.Get("Accept") != "" {
			t.Errorf("Accept should be empty for non-stream, got %q", h.Get("Accept"))
		}
	})
	t.Run("anthropic-compatible x-api-key", func(t *testing.T) {
		h := BuildHeaders(&Credentials{Provider: "anthropic-compatible-x", APIKey: "sk-ant"}, false)
		if got := h.Get("x-api-key"); got != "sk-ant" {
			t.Errorf("x-api-key = %q, want sk-ant", got)
		}
		if got := h.Get("anthropic-version"); got != "2023-06-01" {
			t.Errorf("anthropic-version = %q, want 2023-06-01", got)
		}
	})
	t.Run("stream Accept header", func(t *testing.T) {
		h := BuildHeaders(&Credentials{Provider: "openai-compatible-x"}, true)
		if got := h.Get("Accept"); got != "text/event-stream" {
			t.Errorf("Accept = %q, want text/event-stream", got)
		}
	})
}

// --- TestExecuteSuccess --------------------------------------------------

func TestExecuteSuccess(t *testing.T) {
	var gotURL, gotAuth, gotCT string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotURL = r.URL.String()
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.Write(body) // echo back
	}))
	defer srv.Close()

	ex := NewExecutor()
	creds := &Credentials{BaseURL: srv.URL, Provider: "openai-compatible-chat-x", APIType: "chat", APIKey: "sk-abc"}
	body := json.RawMessage(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)

	res, err := ex.Execute(context.Background(), ExecInput{Model: "gpt-4", Body: body, Stream: false, Creds: creds})
	if err != nil {
		t.Fatal(err)
	}
	defer res.Resp.Body.Close()

	if res.Resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Resp.StatusCode)
	}
	if gotURL != "/chat/completions" {
		t.Errorf("upstream URL = %q, want /chat/completions", gotURL)
	}
	if gotAuth != "Bearer sk-abc" {
		t.Errorf("Authorization = %q, want Bearer sk-abc", gotAuth)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q", gotCT)
	}
	gotBody, _ := io.ReadAll(res.Resp.Body)
	if !bytes.Equal(gotBody, body) {
		t.Errorf("response body = %s, want echo of request", gotBody)
	}
}

// --- TestExecuteRetryOn502 ----------------------------------------------

func TestExecuteRetryOn502(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&hits, 1)
		if n <= 2 {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	// Use RetryOverride with 0-delay so the test runs fast.
	fastCfg := map[int]RetryConfig{
		http.StatusBadGateway: {Attempts: 3, DelayMs: 1},
	}
	ex := NewExecutor()
	creds := &Credentials{BaseURL: srv.URL, Provider: "openai-compatible-chat-x", APIType: "chat", APIKey: "k"}
	body := json.RawMessage(`{}`)

	res, err := ex.Execute(context.Background(), ExecInput{Body: body, Creds: creds, RetryOverride: fastCfg})
	if err != nil {
		t.Fatal(err)
	}
	res.Resp.Body.Close()
	if got := atomic.LoadInt32(&hits); got != 3 {
		t.Errorf("hits = %d, want 3 (2 retries + 1 success)", got)
	}
}

// --- TestExecuteNoRetryOn401 ---------------------------------------------

func TestExecuteNoRetryOn401(t *testing.T) {
	var hits int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	fastCfg := map[int]RetryConfig{
		http.StatusBadGateway: {Attempts: 3, DelayMs: 1},
	}
	ex := NewExecutor()
	creds := &Credentials{BaseURL: srv.URL, Provider: "openai-compatible-chat-x", APIType: "chat", APIKey: "bad"}
	body := json.RawMessage(`{}`)

	res, err := ex.Execute(context.Background(), ExecInput{Body: body, Creds: creds, RetryOverride: fastCfg})
	// 401 is non-retryable → returned to caller as the response (no error).
	if err != nil {
		t.Fatalf("401 should not error, got: %v", err)
	}
	if res.Resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", res.Resp.StatusCode)
	}
	res.Resp.Body.Close()
	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Errorf("hits = %d, want 1 (no retry on 401)", got)
	}
}

// --- TestTransformJSONSchemaFallback --------------------------------------

func TestTransformJSONSchemaFallback(t *testing.T) {
	body := json.RawMessage(`{
		"model":"gpt-4",
		"response_format":{"type":"json_schema","json_schema":{"name":"out","schema":{"type":"object","properties":{"answer":{"type":"string"}}}}},
		"messages":[{"role":"system","content":"be brief"},{"role":"user","content":"what is 2+2?"}]
	}`)

	out := TransformRequest("gpt-4", body, "openai-compatible-chat-x")

	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatal(err)
	}
	// response_format downgraded to json_object.
	rf, _ := m["response_format"].(map[string]any)
	if rf == nil || rf["type"] != "json_object" {
		t.Errorf("response_format = %v, want json_object", m["response_format"])
	}
	// System message now carries the schema instruction.
	msgs, _ := m["messages"].([]any)
	if len(msgs) < 1 {
		t.Fatal("no messages")
	}
	sys, _ := msgs[0].(map[string]any)
	if sys == nil || sys["role"] != "system" {
		t.Fatalf("first message = %v, want system", msgs[0])
	}
	content, _ := sys["content"].(string)
	if !strings.Contains(content, "strictly follows this JSON schema") {
		t.Errorf("system content missing schema instruction: %q", content)
	}
	// Original instruction preserved.
	if !strings.Contains(content, "be brief") {
		t.Errorf("system content lost original text: %q", content)
	}
}

func TestTransformRequestNoOpForNonOpenAI(t *testing.T) {
	body := json.RawMessage(`{"response_format":{"type":"json_schema","json_schema":{"schema":{}}}}`)
	out := TransformRequest("m", body, "anthropic-compatible-x")
	if !bytes.Equal(out, body) {
		t.Error("non-openai-compatible provider should return body unchanged")
	}
}

func TestTransformRequestNoJSONSchema(t *testing.T) {
	body := json.RawMessage(`{"response_format":{"type":"json_object"}}`)
	out := TransformRequest("m", body, "openai-compatible-chat-x")
	if !bytes.Equal(out, body) {
		t.Error("non-json_schema response_format should be unchanged")
	}
}
