import { useEffect, useRef, useState } from "react";

export const ASSISTANT_WELCOME =
  'Hi—I am Sigla Assistant. Ask about using SiglaCast (events voting, announcements, Community, Messages, profile). Answers are informational only—not official DosU policy. Say "Ingles" if you prefer English.';

/** Embedded in Messages thread or full page — shared UI + state. */
export function AssistantChatCore({ chatWithGroq }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(() => [{ role: "assistant", content: ASSISTANT_WELCOME }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function submit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy || typeof chatWithGroq !== "function") return;

    setError("");
    const userMsg = { role: "user", content: text };
    const transcript = [...messages, userMsg];
    setMessages(transcript);
    setInput("");
    setBusy(true);

    const payload = transcript
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await chatWithGroq(payload);
      setBusy(false);
      if (res?.error) {
        setError(res.error);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              `I could not reach Sigla Assistant just now (${res.error}). If this persists, admins should verify GROQ_API_KEY on the server.`
          }
        ]);
        return;
      }
      const reply = typeof res.reply === "string" ? res.reply.trim() : "";
      if (!reply) {
        setError("Sigla Assistant returned an empty reply.");
        return;
      }
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (_) {
      setBusy(false);
      setError("Network error talking to Sigla Assistant.");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Something went wrong on the connection. Retry in a moment." }
      ]);
    }
  }

  function clearConversation() {
    setError("");
    setMessages([{ role: "assistant", content: ASSISTANT_WELCOME }]);
  }

  return (
    <div className="assistant-chat-core">
      {error ? <div className="assistant-inline-error muted small">{error}</div> : null}
      <div className="assistant-thread">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`assistant-row ${m.role === "user" ? "assistant-row-user" : "assistant-row-ai"}`}
          >
            <span className="assistant-meta">{m.role === "user" ? "You" : "Sigla Assistant"}</span>
            <div className="assistant-bubble">{m.content}</div>
          </div>
        ))}
        {busy ? (
          <div className="assistant-row assistant-row-ai">
            <span className="assistant-meta">Sigla Assistant</span>
            <div className="assistant-bubble assistant-typing muted">Typing…</div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <form className="composer assistant-composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about navigating SiglaCast, voting, announcements…"
          rows={3}
          disabled={busy}
        />
        <div className="assistant-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
            Send
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearConversation} disabled={busy}>
            Clear chat
          </button>
        </div>
      </form>
    </div>
  );
}

export default function AssistantPage({ chatWithGroq }) {
  return (
    <section className="panel single assistant-panel">
      <div className="panel-head">
        <h2>✨ Sigla Assistant</h2>
        <p>Groq-powered campus helper (students & admins)—answers are unofficial guidance only.</p>
      </div>
      <AssistantChatCore chatWithGroq={chatWithGroq} />
    </section>
  );
}
