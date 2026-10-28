// /dashboard/custom-payloads — user-managed custom payloads.
// Table + import from GitHub URL + save individual .md/.txt + delete.
// Backing data lives in <dataDir>/custom-payloads/ (loader scans it on boot
// via open-sse/payload/jailbreakPayloads.js).
import CustomPayloadsClient from "./CustomPayloadsClient";

export default function CustomPayloadsPage() {
  return <CustomPayloadsClient />;
}
