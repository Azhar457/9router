package executor

import "strings"

const (
	openaiCompatPrefix     = "openai-compatible-"
	anthropicCompatPrefix  = "anthropic-compatible-"
	openaiCompatChatPath   = "/chat/completions"
	openaiCompatRespPath   = "/responses"
	anthropicCompatMsgPath = "/messages"
)

// BuildURL ports base.js buildUrl() + default.js buildUrl() for the
// compat-node path. The URL type is decided by Credentials.APIType when it is
// set ("chat"/"responses"), else the provider id substring is the fallback
// (legacy nodes embed the type in the id), else "chat".
func BuildURL(model string, stream bool, creds *Credentials) string {
	if creds == nil {
		return ""
	}
	base := strings.TrimSuffix(creds.BaseURL, "/")

	switch {
	case strings.HasPrefix(creds.Provider, anthropicCompatPrefix):
		return base + anthropicCompatMsgPath
	case strings.HasPrefix(creds.Provider, openaiCompatPrefix):
		apiType := creds.APIType
		if apiType == "" {
			// Legacy fallback: node id embeds the type (openai-compatible-<type>-<uuid>).
			if strings.Contains(creds.Provider, "responses") {
				apiType = "responses"
			} else {
				apiType = "chat"
			}
		}
		if apiType == "responses" {
			return base + openaiCompatRespPath
		}
		return base + openaiCompatChatPath
	default:
		// Unknown provider prefix: use the base URL as-is. The caller should
		// have routed this through the JS executor; this is a safety net.
		return base
	}
}
