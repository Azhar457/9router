import PenetrationTabClient from "./PenetrationTabClient";

// /dashboard/penetration — the Penetration tab entry point. Presentation
// layer only: one client component, no backend surface of its own. The
// scope banner, skill orchestrator UI, and env-flag empty state live
// inside PenetrationTabClient.
export default function PenetrationPage() {
  return <PenetrationTabClient />;
}
