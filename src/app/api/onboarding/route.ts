import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { handleRoute } from "@/lib/api-response";
import { UnauthorizedError } from "@/lib/auth";
import { z } from "zod";

const onboardingSchema = z.object({
  business_name: z.string().trim().min(1).max(120),
  owner_full_name: z.string().trim().min(1).max(120),
});

// Kayıt olan ilk kullanıcı için işletme + business_owner kaydını oluşturur.
// Zaten bir business_owner kaydı varsa dokunmaz (tek seferlik onboarding).
export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new UnauthorizedError();

    const { business_name, owner_full_name } = onboardingSchema.parse(
      await request.json()
    );

    const { data: existingOwner } = await supabase
      .from("business_owners")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (existingOwner) {
      return NextResponse.json(
        { error: "already_onboarded" },
        { status: 409 }
      );
    }

    // İlk kayıt anında current_business_id() henüz bir owner satırı olmadığı
    // için NULL döner ve normal (RLS'li) client ile insert reddedilir — bu
    // yüzden bu dar, doğrulanmış bootstrap adımı için admin client kullanılır.
    const admin = createAdminSupabaseClient();

    const { data: business, error: businessError } = await admin
      .from("businesses")
      .insert({ name: business_name })
      .select()
      .single();

    if (businessError) throw businessError;

    const { data: owner, error: ownerError } = await admin
      .from("business_owners")
      .insert({
        business_id: business.id,
        auth_user_id: user.id,
        full_name: owner_full_name,
      })
      .select()
      .single();

    if (ownerError) throw ownerError;

    return NextResponse.json({ data: { business, owner } }, { status: 201 });
  });
}
