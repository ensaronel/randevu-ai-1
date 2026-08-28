import { NextRequest, NextResponse } from "next/server";
import { requireBusinessOwner } from "@/lib/auth";
import { handleRoute } from "@/lib/api-response";
import { serviceCreateSchema } from "@/lib/validation";

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const includeInactive = request.nextUrl.searchParams.get("all") === "true";

    let query = supabase
      .from("services")
      .select("*")
      .eq("business_id", owner.business_id)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (!includeInactive) {
      query = query.eq("status", "active");
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ data });
  });
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const { owner, supabase } = await requireBusinessOwner();
    const body = serviceCreateSchema.parse(await request.json());

    const { data, error } = await supabase
      .from("services")
      .insert({ ...body, business_id: owner.business_id })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  });
}
