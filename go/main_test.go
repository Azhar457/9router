package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// Smallest check that fails if proxying or client-IP stamping breaks.
func TestProxyForwardsBodyAndStampsRealIP(t *testing.T) {
	var gotBody, gotRealIP, gotHost string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		gotRealIP = r.Header.Get("X-Real-IP")
		gotHost = r.Host
		w.Header().Set("X-Upstream", "yes")
		w.WriteHeader(http.StatusTeapot)
		// SSE-ish: flush a chunk before finishing.
		w.Write([]byte("data: hi\n\n"))
	}))
	defer upstream.Close()

	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}

	gw := httptest.NewServer(accessLog(newProxy(target)))
	defer gw.Close()

	req, _ := http.NewRequest(http.MethodPost, gw.URL+"/v1/chat/completions", strings.NewReader(`{"model":"x"}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("gateway request: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusTeapot {
		t.Errorf("status = %d, want 418", resp.StatusCode)
	}
	if gotBody != `{"model":"x"}` {
		t.Errorf("upstream body = %q", gotBody)
	}
	if resp.Header.Get("X-Upstream") != "yes" {
		t.Error("upstream response header missing")
	}
	if !strings.Contains(string(body), "data: hi") {
		t.Errorf("body = %q, want SSE chunk", body)
	}
	if gotRealIP == "" {
		t.Error("X-Real-IP empty")
	}
	if gotHost == "" {
		t.Error("Host header lost")
	}
}
