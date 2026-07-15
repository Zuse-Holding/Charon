import { notFound } from "next/navigation";
import { requireInternalTier } from "../../lib/require-internal-tier";
import OpsClient from "./OpsClient";

export default async function OpsPage() {
  const gate = await requireInternalTier();
  if (!gate.ok) {
    notFound();
  }

  return <OpsClient />;
}
