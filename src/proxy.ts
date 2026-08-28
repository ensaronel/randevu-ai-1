import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// middleware.ts değil proxy.ts — Next.js 16'da isim değişti (bkz. node_modules/next/dist/docs).
export async function proxy(request: NextRequest) {
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

  if (!user && isApiRoute && !isPublicApi) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!user && !isLoginPage && !isApiRoute && pathname !== "/") {
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
