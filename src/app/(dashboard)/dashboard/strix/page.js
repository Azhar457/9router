import StrixTabClient from "./StrixTabClient";

// /dashboard/strix — the Strix security-skills tab entry point. Presentation
// layer only: one client component, no backend surface of its own (the skill
// fetch/copy logic lives in StrixTabClient against the existing
// /api/developer/strix-payload and /api/developer/skill-raw endpoints).
export default function StrixPage() {
  return <StrixTabClient />;
}
