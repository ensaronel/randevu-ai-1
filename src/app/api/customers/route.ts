import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { customerCreateSchema, sanitizeSearchTerm } from "@/lib/validation";

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const search = request.nextUrl.searchParams.get("q");

    let query = supabase
      .from("customers")
      .select("*")
      .eq("business_id", owner.business_id)
      .eq("status", "active")
      .order("full_name", { ascending: true });

    if (search) {
      const term = sanitizeSearchTerm(search);
      query = query.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = customerCreateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("customers")
      .insert({ ...body, business_id: owner.business_id })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        // aynı telefon numarası zaten kayıtlı (business_id, phone) unique kısıtı
        return NextResponse.json(
          { error: "phone_already_exists" },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data }, { status: 201 });
  });
}
