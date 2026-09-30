package rtk

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"unicode/utf16"
)

type Hit struct {
	Shape  string `json:"shape"`
	Filter string `json:"filter"`
	Saved  int    `json:"saved"`
}

type Stats struct {
	BytesBefore int   `json:"bytesBefore"`
	BytesAfter  int   `json:"bytesAfter"`
	Hits        []Hit `json:"hits"`
}

// jsLen = JS string .length (UTF-16 code units).
func jsLen(s string) int {
	return len(utf16.Encode([]rune(s)))
}

func safeApply(name string, fn func(string) string, text string) (out string) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[rtk] warning: filter '%s' panicked — passing through raw output: %v", name, r)
			out = text
		}
	}()
	return fn(text)
}

func compressText(text string, stats *Stats, shape string) string {
	bytesIn := jsLen(text)
	stats.BytesBefore += bytesIn

	if bytesIn < MinCompressSize || bytesIn > RawCap {
		stats.BytesAfter += bytesIn
		return text
	}

	f := detectFilter(text)
	if f == nil {
		stats.BytesAfter += bytesIn
		return text
	}

	out := safeApply(f.name, f.fn, text)

	// Safety: never return empty, never grow the input
	if out == "" || jsLen(out) >= bytesIn {
		stats.BytesAfter += bytesIn
		return text
	}

	stats.BytesAfter += jsLen(out)
	stats.Hits = append(stats.Hits, Hit{shape, f.name, bytesIn - jsLen(out)})
	return out
}

// CompressMessages ports compressMessages. Returns (body, nil, nil) when
// disabled, unmatched, or failed — caller treats nil stats as "no RTK".
func CompressMessages(body json.RawMessage, enabled bool) (out json.RawMessage, stats *Stats, err error) {
	if !enabled || len(body) == 0 {
		return body, nil, nil
	}
	var v any
	if err = json.Unmarshal(body, &v); err != nil {
		return body, nil, err
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[RTK] compressMessages error: %v", r)
			out, stats, err = body, nil, nil
		}
	}()
	stats = &Stats{Hits: []Hit{}}
	if !compressValue(v, stats) {
		return body, nil, nil
	}
	marshaled, mErr := json.Marshal(v)
	if mErr != nil {
		return body, nil, nil
	}
	return marshaled, stats, nil
}

func compressValue(v any, stats *Stats) bool {
	m, ok := v.(map[string]any)
	if !ok {
		return false
	}

	// Kiro format: conversationState.history + currentMessage
	if cs, ok := m["conversationState"].(map[string]any); ok {
		compressKiro(cs, stats)
		return true
	}

	var items []any
	if arr, ok := m["messages"].([]any); ok {
		items = arr
	} else if arr, ok := m["input"].([]any); ok {
		items = arr
	} else {
		return false
	}

	for _, it := range items {
		msg, ok := it.(map[string]any)
		if !ok || msg == nil {
			continue
		}

		// Shape 4: OpenAI Responses function_call_output
		if t, _ := msg["type"].(string); t == "function_call_output" {
			switch o := msg["output"].(type) {
			case string:
				msg["output"] = compressText(o, stats, "openai-responses-string")
			case []any:
				for k, part := range o {
					if pm, ok := part.(map[string]any); ok && pm["type"] == "input_text" {
						if txt, ok := pm["text"].(string); ok {
							pm["text"] = compressText(txt, stats, "openai-responses-array")
							o[k] = pm
						}
					}
				}
			}
			continue
		}

		role, _ := msg["role"].(string)

		// Shape 1: tool content string
		if role == "tool" {
			if s, ok := msg["content"].(string); ok {
				msg["content"] = compressText(s, stats, "openai-tool")
				continue
			}
		}

		content, isArr := msg["content"].([]any)
		if !isArr {
			continue
		}

		// Shape 1b: tool content array
		if role == "tool" {
			for k, part := range content {
				if pm, ok := part.(map[string]any); ok && pm["type"] == "text" {
					if txt, ok := pm["text"].(string); ok {
						pm["text"] = compressText(txt, stats, "openai-tool-array")
						content[k] = pm
					}
				}
			}
			continue
		}

		// Shapes 2/3: tool_result blocks
		for j, blk := range content {
			block, ok := blk.(map[string]any)
			if !ok || block["type"] != "tool_result" {
				continue
			}
			if isErr, _ := block["is_error"].(bool); isErr {
				continue
			}
			switch c := block["content"].(type) {
			case string:
				block["content"] = compressText(c, stats, "claude-string")
			case []any:
				for k, part := range c {
					if pm, ok := part.(map[string]any); ok && pm["type"] == "text" {
						if txt, ok := pm["text"].(string); ok {
							pm["text"] = compressText(txt, stats, "claude-array")
							c[k] = pm
						}
					}
				}
			}
			content[j] = block
		}
	}
	return true
}

// compressKiro walks history[] + currentMessage toolResults.
func compressKiro(state map[string]any, stats *Stats) {
	var msgs []any
	if h, ok := state["history"].([]any); ok {
		msgs = append(msgs, h...)
	}
	if cm, ok := state["currentMessage"]; ok && cm != nil {
		msgs = append(msgs, cm)
	}
	for _, msg := range msgs {
		m, ok := msg.(map[string]any)
		if !ok {
			continue
		}
		ctx, _ := path(m, "userInputMessage", "userInputMessageContext")
		toolResults, ok := ctx["toolResults"].([]any)
		if !ok {
			continue
		}
		for _, trRaw := range toolResults {
			tr, ok := trRaw.(map[string]any)
			if !ok {
				continue
			}
			if st, _ := tr["status"].(string); st == "error" {
				continue
			}
			parts, ok := tr["content"].([]any)
			if !ok {
				continue
			}
			for _, partRaw := range parts {
				part, ok := partRaw.(map[string]any)
				if !ok {
					continue
				}
				if txt, ok := part["text"].(string); ok {
					part["text"] = compressText(txt, stats, "kiro-tool-result")
				}
			}
		}
	}
}

func path(m map[string]any, keys ...string) (map[string]any, bool) {
	cur := m
	for _, k := range keys {
		next, ok := cur[k].(map[string]any)
		if !ok {
			return nil, false
		}
		cur = next
	}
	return cur, true
}

// FormatLog ports formatRtkLog — null (empty string) when no hits.
func FormatLog(stats *Stats) string {
	if stats == nil || len(stats.Hits) == 0 {
		return ""
	}
	saved := stats.BytesBefore - stats.BytesAfter
	pct := "0"
	if stats.BytesBefore > 0 {
		pct = fmt.Sprintf("%.1f", float64(saved)/float64(stats.BytesBefore)*100)
	}
	seen := map[string]bool{}
	var filters []string
	for _, h := range stats.Hits {
		if !seen[h.Filter] {
			seen[h.Filter] = true
			filters = append(filters, h.Filter)
		}
	}
	return fmt.Sprintf("[RTK] saved %dB / %dB (%s%%) via [%s] hits=%d",
		saved, stats.BytesBefore, pct, strings.Join(filters, ","), len(stats.Hits))
}
