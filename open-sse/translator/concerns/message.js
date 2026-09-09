import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: text-only arrays become a plain
// string joined with "\n" (preserves the line structure of Claude block arrays
// and matches the pre-DRY translator behavior), while mixed (multimodal)
// arrays are returned as-is.
export function collapseTextParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  if (!parts.every(p => p?.type === OPENAI_BLOCK.TEXT && typeof p.text === "string")) return parts;
  return parts.map(p => p.text).join("\n");
}
