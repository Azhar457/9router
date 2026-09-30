package rtk

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type fixture struct {
	Name     string          `json:"name"`
	Input    json.RawMessage `json:"input"`
	Output   json.RawMessage `json:"output"`
	Stats    *Stats          `json:"stats"`
	Log      *string         `json:"log"`
	Disabled json.RawMessage `json:"disabledStats"`
}

func loadFixtures(t *testing.T) []fixture {
	t.Helper()
	files, err := filepath.Glob(filepath.Join("testdata", "*.json"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no fixtures found: %v", err)
	}
	var out []fixture
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		var fx fixture
		if err := json.Unmarshal(raw, &fx); err != nil {
			t.Fatalf("parse %s: %v", f, err)
		}
		out = append(out, fx)
	}
	return out
}

func TestParityWithJS(t *testing.T) {
	for _, fx := range loadFixtures(t) {
		t.Run(fx.Name, func(t *testing.T) {
			gotBody, gotStats, err := CompressMessages(fx.Input, true)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if fx.Stats == nil {
				if gotStats != nil {
					t.Fatalf("expected nil stats, got %+v", gotStats)
				}
				return
			}
			if gotStats == nil {
				t.Fatalf("expected stats, got nil")
			}

			if !reflect.DeepEqual(gotStats, fx.Stats) {
				t.Errorf("stats mismatch\ngot:  %+v\nwant: %+v", gotStats, fx.Stats)
			}

			var gotV, wantV any
			if err := json.Unmarshal(gotBody, &gotV); err != nil {
				t.Fatalf("unmarshal got body: %v", err)
			}
			if err := json.Unmarshal(fx.Output, &wantV); err != nil {
				t.Fatalf("unmarshal want body: %v", err)
			}
			if !reflect.DeepEqual(gotV, wantV) {
				gotJ, _ := json.MarshalIndent(gotV, "", " ")
				wantJ, _ := json.MarshalIndent(wantV, "", " ")
				t.Errorf("body mismatch\ngot:\n%s\nwant:\n%s", gotJ, wantJ)
			}

			gotLog := FormatLog(gotStats)
			wantLog := ""
			if fx.Log != nil {
				wantLog = *fx.Log
			}
			if gotLog != wantLog {
				t.Errorf("log mismatch\ngot:  %q\nwant: %q", gotLog, wantLog)
			}
		})
	}
}

func TestDisabledReturnsOriginal(t *testing.T) {
	for _, fx := range loadFixtures(t) {
		in := append(json.RawMessage(nil), fx.Input...)
		gotBody, gotStats, _ := CompressMessages(in, false)
		if gotStats != nil {
			t.Errorf("%s: expected nil stats when disabled", fx.Name)
		}
		if string(gotBody) != string(fx.Input) {
			t.Errorf("%s: body changed when disabled", fx.Name)
		}
	}
}

func TestNoGrowthAndNoEmpty(t *testing.T) {
	// Property: for any text, compressText never returns empty or larger output.
	texts := []string{"", "tiny", "a\x00b", "日本語テキスト" + string(make([]byte, 0)), "\n\n\n"}
	for _, s := range texts {
		stats := &Stats{Hits: []Hit{}}
		out := compressText(s, stats, "test")
		if out == "" && s != "" {
			t.Errorf("empty output for input len %d", len(s))
		}
		if s != "" && jsLen(out) > jsLen(s) {
			t.Errorf("growth: %d -> %d", jsLen(s), jsLen(out))
		}
	}
}

func TestFormatLogEmpty(t *testing.T) {
	if FormatLog(nil) != "" {
		t.Error("nil stats should format to empty")
	}
	if FormatLog(&Stats{Hits: []Hit{}}) != "" {
		t.Error("no hits should format to empty")
	}
}
