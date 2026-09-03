import { z } from "zod";

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
// HH:MM zero-padded olduğu için (regex bunu garanti eder) string karşılaştırması
// saat karşılaştırmasıyla aynı sonucu verir — ayrı bir dakika-parse fonksiyonuna gerek yok.
const dayShiftSchema = z
  .tuple([z.string(), z.string()])
  .refine(([start, end]) => HHMM_REGEX.test(start) && HHMM_REGEX.test(end), {
    message: "Saat HH:MM formatında olmalı (ör. 09:00)",
  })
  .refine(([start, end]) => end > start, {
    message: "Bitiş saati başlangıç saatinden sonra olmalı",
  });

export const serviceCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  duration_minutes: z.number().int().positive().max(600),
  price: z.number().nonnegative(),
  category: z.string().trim().max(60).optional().nullable(),
});
export const serviceUpdateSchema = serviceCreateSchema.partial().extend({
  status: z.enum(["active", "inactive"]).optional(),
});

export const staffCreateSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  commission_rate: z.number().min(0).max(100).optional(),
  working_hours: z.record(z.string(), dayShiftSchema).optional(),
});
export const staffUpdateSchema = staffCreateSchema.partial().extend({
  status: z.enum(["active", "inactive"]).optional(),
  leave_dates: z.array(z.string()).optional(),
});

export const customerCreateSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(7).max(20),
  notes: z.string().trim().max(2000).optional().nullable(),
  preferred_staff_id: z.uuid().optional().nullable(),
});
export const customerUpdateSchema = customerCreateSchema.partial().extend({
  status: z.enum(["active", "inactive"]).optional(),
  kvkk_consent_at: z.iso.datetime().optional().nullable(),
});

export const appointmentServiceInputSchema = z.object({
  service_id: z.uuid(),
  staff_id: z.uuid(),
  planned_price: z.number().nonnegative(),
});

export const appointmentCreateSchema = z.object({
  customer_id: z.uuid(),
  starts_at: z.iso.datetime(),
  ends_at: z.iso.datetime(),
  source: z.enum(["whatsapp_ai", "manual", "phone_ai"]).default("manual"),
  services: z.array(appointmentServiceInputSchema).min(1),
});

export const appointmentUpdateSchema = z.object({
  status: z.enum(["scheduled", "confirmed", "cancelled", "completed"]).optional(),
  attendance: z.enum(["came", "no_show_notified", "no_show_silent"]).optional().nullable(),
  starts_at: z.iso.datetime().optional(),
  ends_at: z.iso.datetime().optional(),
});

export const appointmentServiceUpdateSchema = z.object({
  final_price: z.number().nonnegative().optional().nullable(),
  adjustment_note: z.string().trim().max(500).optional().nullable(),
});

export const reconcileDaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expenses: z.number().nonnegative().optional(),
});

export const actionObjectUpdateSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export const assistantQuestionSchema = z.object({
  question: z.string().trim().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string() }))
    .max(20)
    .optional(),
});

/**
 * PostgREST'in `.or()` filtre sözdizimini (virgül, parantez, `%` joker) bozabilecek
 * karakterleri temizler — arama terimi doğrudan `.or()` string'ine gömülen her
 * yerde kullanılmalı, aksi halde kullanıcı girdisi filtreyi manipüle edebilir.
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()%]/g, "");
}

export const businessUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  working_hours: z.record(z.string(), dayShiftSchema).optional(),
  closed_dates: z.array(z.string()).optional(),
});
