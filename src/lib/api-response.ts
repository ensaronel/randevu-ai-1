import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "@/lib/auth";

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
