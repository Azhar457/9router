// 9router gateway: reverse proxy in front of the Next.js server.
// Owns public entry (client IP stamping, access log, graceful shutdown).
// Next.js keeps all app logic — zero behavior change by design.
package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func newProxy(target *url.URL) *httputil.ReverseProxy {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(target)
			// Preserve original Host so Next.js route matching is untouched.
			r.Out.Host = r.In.Host
			r.SetXForwarded()
			// custom-server.js trusts X-Real-IP only from loopback peers —
			// we always dial upstream over loopback, so stamp the real client IP.
			if ip, _, err := net.SplitHostPort(r.In.RemoteAddr); err == nil {
				r.Out.Header.Set("X-Real-IP", ip)
			}
		},
		// Flush immediately: /v1 responses are SSE streams.
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, req *http.Request, err error) {
			log.Printf("proxy error %s %s: %v", req.Method, req.URL.Path, err)
			w.WriteHeader(http.StatusBadGateway)
			fmt.Fprintln(w, "upstream unavailable")
		},
	}
	return proxy
}

func accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		log.Printf("%s %s -> %d %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Flush passthrough keeps SSE streaming through the logger wrapper.
func (w *statusWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func main() {
	addr := envOr("GATEWAY_ADDR", ":20127")
	upstream := envOr("UPSTREAM", "http://127.0.0.1:20129")

	target, err := url.Parse(upstream)
	if err != nil {
		log.Fatalf("bad UPSTREAM %q: %v", upstream, err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", newProxy(target))
	srv := &http.Server{
		Addr:              addr,
		Handler:           accessLog(mux),
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("gateway listening on %s -> %s", addr, upstream)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("gateway shutting down")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("shutdown: %v", err)
	}
}
