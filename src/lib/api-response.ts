import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth";

/**
 * Vercel Cron isteklerini doğrular — `Authorization: Bearer <CRON_SECRET>` header'ını
 * sabit-zamanlı karşılaştırır. `CRON_SECRET` env'de tanımsızsa güvenli tarafta kalıp
 * her zaman false döner (fail-closed) — env değişkeni unutulursa route açık kalmaz.
 */
export function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const bufA = Buffer.from(header);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Tüm route handler'ları bu sarmalayıcıdan geçer — auth/validasyon/beklenmeyen
 * hataları tek yerden, tutarlı bir JSON gövdesiyle döner.
 */
export async function handleRoute(
  fn: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "invalid_input", details: err.issues },
        { status: 400 }
      );
    }
    console.error(err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
