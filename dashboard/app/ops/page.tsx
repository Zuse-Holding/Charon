import OpsClient from "./OpsClient";

// Live realtime dashboard — never statically prerendered.
export const dynamic = "force-dynamic";

export default function OpsPage() {
  return <OpsClient />;
}
