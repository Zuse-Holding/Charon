"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Size the market for AI-powered SaaS tools in 2025",
  "Who are the top competitors in the esports venue space?",
  "Analyze business model options for a cyber café operator",
  "What's driving growth in the ABA therapy market?",
];

export default function CharonResearch() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<"idle" | "searching" | "synthesizing">("idle");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);
    setPhase("searching");

    try {
      const res = await fetch("/api/research-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: messages }),
      });
      setPhase("synthesizing");
      const data = await res.json();
      const reply = data.reply || "// No response. Try again.";
      setMessages([...newHistory, { role: "assistant", content: reply }]);
    } catch {
      setMessages([
        ...newHistory,
        { role: "assistant", content: "// Signal lost. Check connection." },
      ]);
    } finally {
      setLoading(false);
      setPhase("idle");
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const renderMd = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^#{1,3} (.+)$/gm, '<span style="color:var(--orange);font-weight:600;display:block;margin-top:8px;margin-bottom:2px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase">$1</span>')
      .replace(/^[-•] (.+)$/gm, "<li>$1</li>")
      .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul style="padding-left:14px;margin:4px 0">$1</ul>')
      .replace(/<\/ul>\s*<ul[^>]*>/g, "")
      .replace(/`([^`]+)`/g, '<code style="background:#0A0A0F;padding:1px 4px;border-radius:3px;color:var(--cyan);font-size:11px">$1</code>')
      .split("\n\n")
      .map((p) => (p.startsWith("<") ? p : `<p style="margin-bottom:5px">${p.replace(/\n/g, "<br/>")}</p>`))
      .join("");

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Charon Research Chat"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 1000,
          width: 46,
          height: 46,
          borderRadius: 10,
          background: open ? "var(--orange)" : "var(--surface)",
          border: `1px solid ${open ? "var(--orange)" : "var(--border)"}`,
          color: open ? "#000" : "var(--orange)",
          fontSize: 18,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          transition: "all 0.2s",
          boxShadow: open ? "0 0 16px rgba(255,107,43,0.35)" : "none",
        }}
      >
        {open ? "✕" : "⬡"}
      </button>

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          bottom: 82,
          right: 24,
          zIndex: 999,
          width: 400,
          height: 560,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          fontFamily: "var(--font-mono)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          transition: "opacity 0.2s, transform 0.2s",
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0)" : "translateY(10px)",
          pointerEvents: open ? "all" : "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "10px 14px",
            background: "var(--surface2)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            borderRadius: "12px 12px 0 0",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              background: "var(--bg)",
              border: "1px solid var(--orange)",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--orange)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            ⬡
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--orange)",
                letterSpacing: "0.14em",
                fontFamily: "var(--font-display)",
              }}
            >
              CHARON RESEARCH
            </div>
            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.1em" }}>
              {loading
                ? phase === "searching"
                  ? "SCANNING SOURCES..."
                  : "SYNTHESIZING..."
                : "MARKET INTELLIGENCE · POWERED BY SELENE"}
            </div>
          </div>
          <div
            style={{
              marginLeft: "auto",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: loading ? "var(--cyan)" : "var(--green)",
              boxShadow: `0 0 5px ${loading ? "var(--cyan)" : "var(--green)"}`,
              animation: loading ? "pulse-dot 1s ease-in-out infinite" : "none",
            }}
          />
        </div>

        {/* Messages */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {messages.length === 0 && (
            <div style={{ margin: "auto", textAlign: "center", width: "100%" }}>
              <div
                style={{
                  fontSize: 9,
                  color: "var(--muted)",
                  letterSpacing: "0.14em",
                  marginBottom: 8,
                }}
              >
                // MARKET RESEARCH MODULE
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  lineHeight: 1.9,
                  marginBottom: 14,
                  letterSpacing: "0.03em",
                }}
              >
                Query markets, competitors, trends,
                <br />
                and business models.
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {STARTERS.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s)}
                    style={{
                      padding: "7px 10px",
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      color: "var(--muted)",
                      fontSize: 11,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: "var(--font-mono)",
                      transition: "all 0.12s",
                      letterSpacing: "0.02em",
                      lineHeight: 1.5,
                    }}
                    onMouseEnter={(e) => {
                      (e.target as HTMLElement).style.borderColor = "var(--orange)";
                      (e.target as HTMLElement).style.color = "var(--orange)";
                    }}
                    onMouseLeave={(e) => {
                      (e.target as HTMLElement).style.borderColor = "var(--border)";
                      (e.target as HTMLElement).style.color = "var(--muted)";
                    }}
                  >
                    $ {s} →
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 7,
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                alignItems: "flex-start",
              }}
            >
              {msg.role === "assistant" && (
                <div
                  style={{
                    width: 22,
                    height: 22,
                    background: "var(--bg)",
                    border: "1px solid var(--orange)",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    color: "var(--orange)",
                    fontWeight: 700,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  CR
                </div>
              )}
              <div
                style={{
                  maxWidth: "82%",
                  padding: "8px 11px",
                  fontSize: 11.5,
                  lineHeight: 1.8,
                  letterSpacing: "0.02em",
                  borderRadius: 6,
                  wordBreak: "break-word",
                  ...(msg.role === "user"
                    ? {
                        background: "var(--surface2)",
                        border: "1px solid var(--orange)",
                        color: "var(--orange)",
                        borderRadius: "6px 6px 2px 6px",
                      }
                    : {
                        background: "var(--bg)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        borderRadius: "2px 6px 6px 6px",
                      }),
                }}
                dangerouslySetInnerHTML={
                  msg.role === "assistant" ? { __html: renderMd(msg.content) } : undefined
                }
              >
                {msg.role === "user" ? msg.content : undefined}
              </div>
              {msg.role === "user" && (
                <div
                  style={{
                    width: 22,
                    height: 22,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    color: "var(--muted)",
                    fontWeight: 700,
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  N
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  background: "var(--bg)",
                  border: "1px solid var(--orange)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 8,
                  color: "var(--orange)",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                CR
              </div>
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: "2px 6px 6px 6px",
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                }}
              >
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "var(--orange)",
                      animation: `cr-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
                <span
                  style={{ fontSize: 9, color: "var(--muted)", marginLeft: 4, letterSpacing: "0.1em" }}
                >
                  {phase === "searching" ? "SCANNING SOURCES..." : "SYNTHESIZING..."}
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div
          style={{
            padding: "10px 14px",
            background: "var(--surface2)",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            borderRadius: "0 0 12px 12px",
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-end",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "7px 10px",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "var(--orange)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "var(--border)")
            }
          >
            <span
              style={{
                color: "var(--orange)",
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
                marginBottom: 1,
                userSelect: "none",
              }}
            >
              ›
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              placeholder="enter research query..."
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text)",
                fontSize: 12,
                resize: "none",
                fontFamily: "var(--font-mono)",
                lineHeight: 1.5,
                maxHeight: 68,
                overflowY: "auto",
                letterSpacing: "0.02em",
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              style={{
                width: 26,
                height: 26,
                borderRadius: 5,
                border: "1px solid",
                flexShrink: 0,
                background:
                  loading || !input.trim() ? "var(--surface2)" : "var(--orange)",
                borderColor:
                  loading || !input.trim() ? "var(--border)" : "var(--orange)",
                color: loading || !input.trim() ? "var(--muted)" : "#000",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                transition: "all 0.12s",
              }}
            >
              →
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes cr-bounce {
          0%, 80%, 100% { opacity: 0.2; transform: scale(0.6); }
          40% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  );
}
