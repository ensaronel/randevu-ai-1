"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createBrowserSupabaseClient();

    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      } else {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;

        const onboardRes = await fetch("/api/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_name: businessName,
            owner_full_name: fullName,
          }),
        });
        if (!onboardRes.ok) {
          const body = await onboardRes.json().catch(() => ({}));
          throw new Error(body.error ?? "onboarding_failed");
        }
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "bilinmeyen_hata");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl p-6 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold">
            {mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
          </h1>
          <p className="text-sm text-black/50 mt-1">Randevu AI</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === "signup" && (
            <>
              <input
                type="text"
                placeholder="İşletme adı"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
                className="border border-black/15 rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Adınız Soyadınız"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="border border-black/15 rounded-lg px-3 py-2 text-sm"
              />
            </>
          )}
          <input
            type="email"
            placeholder="E-posta"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border border-black/15 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder="Şifre"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="border border-black/15 rounded-lg px-3 py-2 text-sm"
          />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading ? "..." : mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
          className="text-sm text-accent font-medium"
        >
          {mode === "login"
            ? "Hesabın yok mu? Oluştur"
            : "Zaten hesabın var mı? Giriş yap"}
        </button>
      </div>
    </div>
  );
}
