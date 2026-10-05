import PayloadTabClient from "./PayloadTabClient";

// /dashboard/payload — the Payload/Injection tab entry point. Presentation
// layer only: one client component, no backend surface of its own. The
// consent gate, env-flag empty state, and red/danger theming live inside
// PayloadTabClient.
export default function PayloadPage() {
  return <PayloadTabClient />;
}
