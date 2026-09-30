package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
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

	gw := httptest.NewServer(accessLog(newProxy(target, nil)))
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

// If the gateway ever serializes /v1 streams, the upstream barrier never sees
// 2 concurrent requests and this test fails on timeout instead of passing.
func TestV1StreamsRunConcurrently(t *testing.T) {
	var arrived sync.WaitGroup
	arrived.Add(2)
	release := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		arrived.Done()
		select {
		case <-time.After(3 * time.Second):
			t.Error("upstream saw requests serially — second arrived after 3s")
		case <-release:
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		for i := 0; i < 3; i++ {
			fmt.Fprintf(w, "data: chunk%d\n\n", i)
			w.(http.Flusher).Flush()
			time.Sleep(10 * time.Millisecond)
		}
	}))
	defer upstream.Close()

	target, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	gw := httptest.NewServer(v1Log(newProxy(target, nil)))
	defer gw.Close()

	go func() {
		arrived.Wait()
		close(release)
	}()

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			resp, err := http.Get(fmt.Sprintf("%s/v1/chat/completions?n=%d", gw.URL, n))
			if err != nil {
				errs <- err
				return
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if !strings.Contains(string(body), "data: chunk2") {
				errs <- fmt.Errorf("stream %d incomplete: %q", n, body)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestRTKEndpoint(t *testing.T) {
	payload := `{"messages":[{"role":"tool","content":"` +
		strings.Repeat("commit abc1234\\nAuthor: a\\n", 40) + `"}]}`

	// Non-loopback → 403
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/-/rtk/compress", strings.NewReader(payload))
	rtkHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-loopback: got %d want 403", rec.Code)
	}

	// Loopback → 200 with body + stats envelope
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/-/rtk/compress", strings.NewReader(payload))
	req.RemoteAddr = "127.0.0.1:54321"
	rtkHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("loopback: got %d %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Body  json.RawMessage `json:"body"`
		Stats json.RawMessage `json:"stats"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response: %v", err)
	}
	if len(resp.Body) == 0 {
		t.Fatal("empty body in response")
	}

	// Method guard
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/-/rtk/compress", nil)
	req.RemoteAddr = "127.0.0.1:1"
	rtkHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: got %d want 405", rec.Code)
	}
}
