import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { Business, Service, Staff } from "@/types/database";

export interface AiBusinessContext {
  business: Business;
  services: Service[];
  staff: Staff[];
  expertise: { staff_id: string; service_id: string }[];
  ownerPhone: string | null;
}

/** AI'ın karar vermesi için gereken tüm işletme bağlamını tek seferde toplar. */
export async function loadBusinessContext(businessId: string): Promise<AiBusinessContext> {
  const admin = createAdminSupabaseClient();

  const [{ data: business }, { data: services }, { data: staff }, { data: owner }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", businessId).single(),
    admin.from("services").select("*").eq("business_id", businessId).eq("status", "active"),
    admin.from("staff").select("*").eq("business_id", businessId).eq("status", "active"),
    admin.from("business_owners").select("phone").eq("business_id", businessId).maybeSingle(),
  ]);

  const staffIds = (staff ?? []).map((s) => s.id);
  const { data: expertise } =
    staffIds.length > 0
      ? await admin.from("staff_service_expertise").select("staff_id, service_id").in("staff_id", staffIds)
      : { data: [] };

  return {
    business: business as Business,
    services: (services ?? []) as Service[],
    staff: (staff ?? []) as Staff[],
    expertise: expertise ?? [],
    ownerPhone: owner?.phone ?? null,
  };
}
