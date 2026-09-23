"use client";

import { useState, useRef, useEffect } from "react";
import Mascot from "@/components/Mascot";
import ChatMarkdown from "@/components/ChatMarkdown";

interface Message {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS: { text: string; tone: "accentSoft" | "block2" | "accent2Soft" }[] = [
  { text: "İşletmemi büyütmek için verilerime bakıp bana somut bir plan çıkar", tone: "accent2Soft" },
  { text: "Kâr ediyor muyum? Giderlerim nasıl?", tone: "accentSoft" },
  { text: "Hangi hizmetim en çok kazandırıyor, hangisi verimsiz?", tone: "block2" },
  { text: "En boş saatlerim hangileri, nasıl doldururum?", tone: "accentSoft" },
  { text: "Kaybettiğim müşterileri nasıl geri kazanırım?", tone: "block2" },
  { text: "Bu ay ne kadar kazandım, ay sonu nereye varırım?", tone: "accent2Soft" },
];

const SUGGESTION_TONES = {
  accentSoft: "bg-accent-soft text-accent",
  block2: "bg-block2 text-block2-ink",
  accent2Soft: "bg-accent2-soft text-accent2-ink",
} as const;

export default function AsistanClient({
  initialMessages,
  initialQuestion,
}: {
  initialMessages: Message[];
  /** Dashboard'daki Fırsat Radarı'ndan gelen, otomatik sorulacak soru. */
  initialQuestion?: string;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hintStage, setHintStage] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  // Uzun analizlerde (10-20 sn) ekran donmuş gibi durmasın diye ne yapıldığını kademeli gösterir.
  useEffect(() => {
    if (!sending) return;
    const t1 = setTimeout(() => setHintStage(1), 4000);
    const t2 = setTimeout(() => setHintStage(2), 14000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!initialQuestion || autoSentRef.current) return;
    autoSentRef.current = true;
    void send(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  async function send(question: string) {
    if (!question.trim() || sending) return;
    const nextMessages: Message[] = [...messages, { role: "user", text: question }];
    setMessages(nextMessages);
    setInput("");
    setHintStage(0);
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
            <p className="text-sm text-ink-muted">
              Verilerine bakıp analiz yaparım, fikir üretirim, &quot;şunu yapsam ne olur&quot; senaryolarını hesaplarım:
            </p>
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
              className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
                m.role === "user" ? "bg-accent text-white whitespace-pre-wrap" : "bg-accent2-soft text-accent2-ink"
              }`}
            >
              {m.role === "model" ? <ChatMarkdown text={m.text} /> : m.text}
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
            {hintStage > 0 && (
              <span className="text-[11.5px] text-ink-muted">
                {hintStage === 1 ? "Verilerini inceliyorum…" : "Analiz biraz uzun sürdü, yanıtı hazırlıyorum…"}
              </span>
            )}
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
