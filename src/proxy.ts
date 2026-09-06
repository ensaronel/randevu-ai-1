import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { generalLimiter, isRateLimited } from "@/lib/rateLimit";

// middleware.ts değil proxy.ts — Next.js 16'da isim değişti (bkz. node_modules/next/dist/docs).
export async function proxy(request: NextRequest) {
  // IP basina genel bir hiz siniri - webhook/cron haric (onlar kendi imza/secret
  // kontrolunu yapiyor ve webhook Meta'nin paylasilan IP'lerinden geldigi icin
  // IP bazli sinirlama orada anlamli degil, ayrica AI-tuketen yol zaten
  // src/app/api/whatsapp/webhook/route.ts icinde musteri telefonu bazinda sinirlaniyor).
  const { pathname: rateLimitPath } = request.nextUrl;
  if (!rateLimitPath.startsWith("/api/whatsapp") && !rateLimitPath.startsWith("/api/cron")) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (await isRateLimited(generalLimiter, ip)) {
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    }
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Oturumu tazeler (gerekirse token yeniler) — server component'lerin
  // süresi dolmuş bir oturumla karşılaşmasını engeller.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginPage = pathname.startsWith("/login");
  const isApiRoute = pathname.startsWith("/api");
  // webhook (Meta'dan) ve cron (Vercel'den) - ikisi de kendi secret/imza kontrolünü kendi içinde yapar
  const isPublicApi = pathname.startsWith("/api/whatsapp") || pathname.startsWith("/api/cron");
  // Meta'nın "Live" moda geçiş ve gerçek müşteri gizlilik metni şartı için herkese açık olmalı.
  // /sifre-sifirla: Supabase'in şifre sıfırlama bağlantısındaki oturum bilgisi
  // URL hash'inde taşınır (sunucuya hiç gitmez), bu yüzden bu sayfaya ilk
  // istekte proxy henüz bir kullanıcı görmez — client tarafında hash işlenip
  // gerçek oturum kurulana kadar herkese açık kalmalı.
  const isPublicPage = pathname === "/" || pathname === "/gizlilik" || pathname === "/sifre-sifirla";

  if (!user && isApiRoute && !isPublicApi) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!user && !isLoginPage && !isApiRoute && !isPublicPage) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/whatsapp).*)",
  ],
};
