"use client";

import { trackClientEvent } from "../../../lib/analytics-client";

export default function PrintButton() {
  return (
    <button
      className="print-btn no-print"
      onClick={() => {
        trackClientEvent("pdf_export", { source: "deep_dive_print_page" });
        window.print();
      }}
    >
      Export PDF
    </button>
  );
}
