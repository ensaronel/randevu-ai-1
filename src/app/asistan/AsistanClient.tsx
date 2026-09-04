"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS = ["Bu ay ne kadar kazandım?", "Yarın programım nasıl?", "Bu hafta en çok kim çalıştı?"];

export default function AsistanClient({ initialMessages }: { initialMessages: Message[] }) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(question: string) {
    if (!question.trim() || sending) return;
    const nextMessages: Message[] = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      const replyText = res.ok ? data.replyText : "Bir hata oluştu, lütfen tekrar dene.";
      setMessages([...nextMessages, { role: "model", text: replyText }]);
    } catch {
      setMessages([...nextMessages, { role: "model", text: "Bir hata oluştu, lütfen tekrar dene." }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-4 min-h-0">
      <div>
        <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">AI Asistan</p>
        <h1 className="text-xl font-semibold">Sorularını sor</h1>
      </div>

      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-sm text-ink-muted">Randevu, ciro ve personel verilerine dair soru sorabilirsin:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-left bg-surface border border-border rounded-xl px-3.5 py-2.5 text-sm"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
              m.role === "user" ? "self-end bg-accent text-white" : "self-start bg-surface border border-border"
            }`}
          >
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="self-start bg-surface border border-border rounded-2xl px-3.5 py-2.5 text-[13.5px] text-ink-muted">
            Düşünüyor...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 pt-1">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Bir soru yaz..."
          className="flex-1 border border-border rounded-full px-4 py-2.5 text-sm"
        />
        <button
          onClick={() => send(input)}
          disabled={sending}
          className="bg-accent text-white rounded-full px-5 text-sm font-semibold disabled:opacity-50"
        >
          Gönder
        </button>
      </div>
    </div>
  );
}
