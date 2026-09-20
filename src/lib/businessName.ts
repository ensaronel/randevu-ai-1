import { createAdminSupabaseClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminSupabaseClient>;

export async function getBusinessName(admin: AdminClient, businessId: string): Promise<string> {
  const { data } = await admin.from("businesses").select("name").eq("id", businessId).single();
  return data?.name ?? "İşletmeniz";
}
