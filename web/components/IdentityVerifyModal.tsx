"use client";
import { useState } from "react";
import styles from "./CharonToolModal.module.css";

interface VerifyResult {
  generatedAt: string;
  match: boolean;
  confidence?: number;
  notes?: string;
}

interface Props {
  onClose: () => void;
}

const MAX_FILE_BYTES = 1_572_864; // ~1.5MB — see web/app/api/identity-verify/route.ts for why

function confidenceTier(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 95) return "high";
  if (confidence >= 85) return "medium";
  return "low";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function IdentityVerifyModal({ onClose }: Props) {
  const [subjectName, setSubjectName] = useState("");
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [previewA, setPreviewA] = useState<string | null>(null);
  const [previewB, setPreviewB] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  function pickFile(slot: "A" | "B", file: File | null) {
    setError(null);
    setResult(null);
    if (!file) {
      if (slot === "A") { setFileA(null); setPreviewA(null); } else { setFileB(null); setPreviewB(null); }
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (JPEG or PNG).");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`"${file.name}" is too large — photos must be under 1.5MB.`);
      return;
    }
    const url = URL.createObjectURL(file);
    if (slot === "A") { setFileA(file); setPreviewA(url); } else { setFileB(file); setPreviewB(url); }
  }

  async function runVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!fileA || !fileB || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const [imageA, imageB] = await Promise.all([readAsDataUrl(fileA), readAsDataUrl(fileB)]);
      const res = await fetch("/api/identity-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectName: subjectName.trim() || undefined, imageA, imageB }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (HTTP ${res.status}).`);
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Photo Identity Verification — Charon</span>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>
        <p className={styles.subtitle}>
          Upload two photos to check whether they show the same person. 1:1 comparison only —
          this never searches the web for a face, and neither photo is stored after the check runs.
        </p>

        <form className={styles.form} style={{ flexDirection: "column" as const, gap: 12 }} onSubmit={runVerify}>
          <input
            className={styles.input}
            placeholder="Subject name (optional, for your own reference)"
            value={subjectName}
            onChange={(e) => setSubjectName(e.target.value)}
          />

          <div style={{ display: "flex", gap: 12 }}>
            <PhotoPicker label="Photo A" preview={previewA} onPick={(f) => pickFile("A", f)} />
            <PhotoPicker label="Photo B" preview={previewB} onPick={(f) => pickFile("B", f)} />
          </div>

          <button className={styles.submitBtn} type="submit" disabled={loading || !fileA || !fileB}>
            {loading ? "Comparing…" : "Compare Photos"}
          </button>
        </form>

        {error && <div className={styles.error}>{error}</div>}
        {loading && <div className={styles.loading}>Running comparison…</div>}

        {result && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Result</span>
              <span className={`${styles.sectionStatus} ${result.match ? styles.live : styles.unavailable}`}>
                {result.match ? "Match" : "No Match"}
              </span>
            </div>
            {result.match && result.confidence !== undefined && (
              <div className={styles.entry}>
                Same person, likely.
                <span className={`${styles.confidence} ${styles[confidenceTier(result.confidence)]}`}>
                  {result.confidence.toFixed(1)}% similarity
                </span>
              </div>
            )}
            {!result.match && (
              <div className={styles.empty}>
                {result.notes ?? "No confident match found between these two photos."}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoPicker({ label, preview, onPick }: { label: string; preview: string | null; onPick: (f: File | null) => void }) {
  return (
    <label style={{
      flex: 1, display: "flex", flexDirection: "column" as const, alignItems: "center",
      justifyContent: "center", gap: 6, cursor: "pointer",
      border: "1px dashed var(--border)", borderRadius: 8, padding: 10,
      minHeight: 110, background: "var(--surface2)",
    }}>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={label} style={{ maxHeight: 80, maxWidth: "100%", borderRadius: 4, objectFit: "cover" as const }} />
      ) : (
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{label} — click to choose</span>
      )}
      <input
        type="file"
        accept="image/jpeg,image/png"
        style={{ display: "none" }}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}
