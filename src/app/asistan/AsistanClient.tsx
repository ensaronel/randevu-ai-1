"use client";

import { useState, useRef, useEffect } from "react";
import Mascot from "@/components/Mascot";

interface Message {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS: { text: string; tone: "accentSoft" | "block2" | "accent2Soft" }[] = [
  { text: "Bu ay ne kadar kazandım?", tone: "accentSoft" },
  { text: "Yarın programım nasıl?", tone: "block2" },
  { text: "Bu hafta en çok kim çalıştı?", tone: "accent2Soft" },
];

const SUGGESTION_TONES = {
  accentSoft: "bg-accent-soft text-accent",
  block2: "bg-block2 text-block2-ink",
  accent2Soft: "bg-accent2-soft text-accent2-ink",
} as const;

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
      <div className="flex items-center gap-3">
        <Mascot size={44} />
        <div>
          <p className="text-[12.5px] font-bold text-ink-muted tracking-wide uppercase">Danışmanın</p>
          <h1 className="text-xl font-semibold">Sorularını sor</h1>
        </div>
      </div>

      <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col gap-2 mt-2">
            <p className="text-sm text-ink-muted">Randevu, ciro ve personel verilerine dair soru sorabilirsin:</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                onClick={() => send(s.text)}
                className={`text-left rounded-xl px-3.5 py-2.5 text-sm font-medium ${SUGGESTION_TONES[s.tone]}`}
              >
                {s.text}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex items-end gap-2 ${m.role === "user" ? "self-end" : "self-start"}`}>
            {m.role === "model" && <Mascot size={26} />}
            <div
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                m.role === "user" ? "bg-accent text-white" : "bg-accent2-soft text-accent2-ink"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex items-end gap-2 self-start">
            <span className="inline-block animate-bounce [animation-duration:1.1s]">
              <Mascot size={26} />
            </span>
            <div className="bg-accent2-soft text-accent2-ink rounded-2xl px-4 py-3 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-accent2-ink/60 animate-bounce [animation-delay:0ms] [animation-duration:0.9s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent2-ink/60 animate-bounce [animation-delay:150ms] [animation-duration:0.9s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-accent2-ink/60 animate-bounce [animation-delay:300ms] [animation-duration:0.9s]" />
            </div>
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
