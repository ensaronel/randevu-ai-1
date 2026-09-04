"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function SifreSifirlaPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Şifreler eşleşmiyor.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      // Supabase'in gönderdiği bağlantıdaki kurtarma oturumu URL hash'inden
      // otomatik olarak algılanır (createBrowserClient varsayılanı) — burada
      // sadece o geçici oturumla yeni şifreyi ayarlıyoruz.
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setDone(true);
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
          <h1 className="text-xl font-semibold">{done ? "Şifre güncellendi" : "Yeni şifre belirle"}</h1>
          <p className="text-sm text-black/50 mt-1">
            {done ? "Yeni şifrenle giriş yapabilirsin." : "Randevu AI"}
          </p>
        </div>

        {done ? (
          <button
            onClick={() => router.push("/login")}
            className="bg-accent text-white rounded-lg py-2.5 text-sm font-semibold"
          >
            Giriş sayfasına dön
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="Yeni şifre"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="border border-black/15 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="Yeni şifre (tekrar)"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
              {loading ? "..." : "Şifreyi Güncelle"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
