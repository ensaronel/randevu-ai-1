"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "forgot";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Hesap (auth.signUp) başarıyla oluşturulduktan SONRA onboarding (işletme
  // kaydı) başarısız olursa true olur — bu durumda tekrar signUp denemek
  // "User already registered" hatasına çarpar, oysa oturum zaten kurulu
  // olduğu için sadece onboarding'i tekrar denemek yeterli ve doğru olan.
  const [signedUpAwaitingOnboarding, setSignedUpAwaitingOnboarding] = useState(false);
  const [resetLinkSent, setResetLinkSent] = useState(false);

  async function completeOnboarding() {
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
    router.push("/dashboard");
    router.refresh();
  }

  async function handleForgotSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/sifre-sifirla`,
      });
      if (resetError) throw resetError;
      setResetLinkSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "bilinmeyen_hata");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (signedUpAwaitingOnboarding) {
        await completeOnboarding();
      } else if (mode === "login") {
        const supabase = createBrowserSupabaseClient();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.push("/dashboard");
        router.refresh();
      } else {
        const supabase = createBrowserSupabaseClient();
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        setSignedUpAwaitingOnboarding(true);
        await completeOnboarding();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "bilinmeyen_hata");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "forgot") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl p-6 flex flex-col gap-5">
          <div>
            <h1 className="text-xl font-semibold">Şifremi Unuttum</h1>
            <p className="text-sm text-black/50 mt-1">
              {resetLinkSent
                ? "E-postana bir sıfırlama bağlantısı gönderdik — gelen kutunu kontrol et."
                : "E-posta adresini gir, sana bir sıfırlama bağlantısı gönderelim."}
            </p>
          </div>

          {!resetLinkSent && (
            <form onSubmit={handleForgotSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                placeholder="E-posta"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border border-black/15 rounded-lg px-3 py-2 text-sm"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {loading ? "..." : "Sıfırlama Bağlantısı Gönder"}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => {
              setMode("login");
              setResetLinkSent(false);
              setError(null);
            }}
            className="text-sm text-accent font-medium"
          >
            Giriş sayfasına dön
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl p-6 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold">
            {signedUpAwaitingOnboarding ? "Son bir adım kaldı" : mode === "login" ? "Giriş Yap" : "Hesap Oluştur"}
          </h1>
          <p className="text-sm text-black/50 mt-1">
            {signedUpAwaitingOnboarding
              ? "Hesabınız oluşturuldu, işletme kaydınız tamamlanamadı — tekrar deneyin."
              : "Randevu AI"}
          </p>
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
            disabled={signedUpAwaitingOnboarding}
            className="border border-black/15 rounded-lg px-3 py-2 text-sm disabled:opacity-50"
          />
          {!signedUpAwaitingOnboarding && (
            <input
              type="password"
              placeholder="Şifre"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="border border-black/15 rounded-lg px-3 py-2 text-sm"
            />
          )}

          {mode === "login" && !signedUpAwaitingOnboarding && (
            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setError(null);
              }}
              className="text-[12.5px] text-accent font-medium self-start"
            >
              Şifremi unuttum
            </button>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-50"
          >
            {loading
              ? "..."
              : signedUpAwaitingOnboarding
                ? "Tekrar Dene"
                : mode === "login"
                  ? "Giriş Yap"
                  : "Hesap Oluştur"}
          </button>
        </form>

        {!signedUpAwaitingOnboarding && (
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="text-sm text-accent font-medium"
          >
            {mode === "login"
              ? "Hesabın yok mu? Oluştur"
              : "Zaten hesabın var mı? Giriş yap"}
          </button>
        )}
      </div>
    </div>
  );
}
