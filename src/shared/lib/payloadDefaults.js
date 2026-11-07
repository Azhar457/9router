// Default jailbreak payload for the Global Injection card.
//
// The landing spot whenever the selector has no valid selection: a fresh card,
// or a custom payload that was just deleted / renamed away (see the DELETE and
// PATCH handlers in /api/developer/custom-payload and the validation effect in
// the payload tab). Kept in one module so the client, the settings default and
// the API route cannot drift apart.
//
// NYX V4 multi-AI is the current-generation multi-model payload in the
// shipped collections (open-sse/payload/jailbreakPayloads.js), so it is a more
// useful default than the legacy Classic baseline.
export const DEFAULT_PAYLOAD_LEVEL = "f:ai:nyx-v4";
