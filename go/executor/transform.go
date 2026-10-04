package executor

import (
	"encoding/json"
	"strings"
)

// TransformRequest ports DefaultExecutor.transformRequest() from
// default.js — specifically applyJsonSchemaFallback. The full
// stripUnsupportedParams + injectReasoningContent pipeline is deferred to F4.
//
// It mutates the body in place via json.RawMessage and returns the (possibly
// transformed) body. When the provider is not openai-compatible, or the body
// has no json_schema response_format, it returns the input unchanged.
func TransformRequest(model string, body json.RawMessage, provider string) json.RawMessage {
	if !strings.HasPrefix(provider, "openai-compatible-") {
		return body
	}

	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return body
	}

	rf, ok := m["response_format"].(map[string]any)
	if !ok {
		return body
	}
	if t, _ := rf["type"].(string); t != "json_schema" {
		return body
	}
	schemaObj, ok := rf["json_schema"].(map[string]any)
	if !ok {
		return body
	}
	schema, ok := schemaObj["schema"]
	if !ok || schema == nil {
		return body
	}

	// Build the strict-schema instruction to fold into the system prompt.
	schemaBytes, _ := json.MarshalIndent(schema, "", "  ")
	const strictPrefix = "You must respond with valid JSON that strictly follows this JSON schema:\n```json\n"
	const strictSuffix = "\n```\nRespond ONLY with the JSON object, no other text."
	prompt := strictPrefix + string(schemaBytes) + strictSuffix

	msgs, _ := m["messages"].([]any)
	// Find the first system message; append the prompt, or create one.
	found := false
	for _, raw := range msgs {
		msg, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		if role, _ := msg["role"].(string); role != "system" {
			continue
		}
		found = true
		switch c := msg["content"].(type) {
		case string:
			msg["content"] = c + "\n\n" + prompt
		case []any:
			msg["content"] = append(c, map[string]any{"type": "text", "text": "\n\n" + prompt})
		}
		break
	}
	if !found {
		msgs = append([]any{map[string]any{"role": "system", "content": prompt}}, msgs...)
	}
	m["messages"] = msgs
	m["response_format"] = map[string]any{"type": "json_object"}

	out, err := json.Marshal(m)
	if err != nil {
		return body
	}
	return out
}
