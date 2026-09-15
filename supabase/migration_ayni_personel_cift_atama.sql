-- 2026-09-15: Canlı kullanımda bulunan hata düzeltmesi.
-- Müşteri tek mesajda iki hizmet istediğinde (ör. "sakal + saç kesimi"), AI bazen
-- her ikisini de AYNI ustaya ve AYNI saate atayarak create_appointment çağırıyordu
-- — bir kişi aynı anda iki hizmeti veremeyeceği için bu geçersiz bir randevuydu.
-- create_appointment_with_services fonksiyonundaki çakışma kontrolü SADECE
-- appointments tablosundaki ÖNCEDEN VAR OLAN kayıtlara bakıyordu, insert edilmekte
-- olan p_services dizisinin KENDİ İÇİNDEKİ bir tekrarı yakalamıyordu. Bu dosya
-- sadece bu fonksiyonu günceller — supabase/schema.sql'in güncel hâli zaten bu
-- değişikliği içeriyor, bu dosya Supabase SQL Editor'e kolay yapıştırmak için
-- ayrı çıkarıldı. Çalıştırdıktan sonra silinebilir.

create or replace function create_appointment_with_services(
  p_customer_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_source text,
  p_services jsonb, -- [{ "service_id": "...", "staff_id": "...", "planned_price": 100 }, ...]
  p_business_id uuid default null -- sadece service-role (AI/webhook) çağrılarında geçilir
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_business_id uuid := coalesce(p_business_id, current_business_id());
  v_appointment_id uuid;
  v_conflict_count int;
  v_service jsonb;
  v_staff_id uuid;
begin
  if v_business_id is null then
    raise exception 'unauthorized';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  if not exists (
    select 1 from customers where id = p_customer_id and business_id = v_business_id
  ) then
    raise exception 'invalid_reference';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_services) s
    where not exists (
      select 1 from services where id = (s->>'service_id')::uuid and business_id = v_business_id
    )
    or not exists (
      select 1 from staff where id = (s->>'staff_id')::uuid and business_id = v_business_id
    )
  ) then
    raise exception 'invalid_reference';
  end if;

  -- YENİ KONTROL: aynı personel, tek randevunun kendi p_services dizisi içinde
  -- birden fazla hizmete atanmış olamaz.
  if (select count(*) from jsonb_array_elements(p_services)) <>
     (select count(distinct (s->>'staff_id')) from jsonb_array_elements(p_services) s)
  then
    raise exception 'staff_conflict';
  end if;

  for v_staff_id in
    select distinct (s->>'staff_id')::uuid
    from jsonb_array_elements(p_services) s
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(v_staff_id::text));
  end loop;

  select count(*) into v_conflict_count
  from appointment_services asvc
  join appointments a on a.id = asvc.appointment_id
  where a.business_id = v_business_id
    and a.status != 'cancelled'
    and asvc.staff_id in (select (s->>'staff_id')::uuid from jsonb_array_elements(p_services) s)
    and a.starts_at < p_ends_at
    and a.ends_at > p_starts_at;

  if v_conflict_count > 0 then
    raise exception 'staff_conflict';
  end if;

  insert into appointments (business_id, customer_id, starts_at, ends_at, source)
  values (v_business_id, p_customer_id, p_starts_at, p_ends_at, coalesce(p_source, 'manual'))
  returning id into v_appointment_id;

  for v_service in select * from jsonb_array_elements(p_services)
  loop
    insert into appointment_services (appointment_id, service_id, staff_id, planned_price, commission_rate_snapshot)
    values (
      v_appointment_id,
      (v_service->>'service_id')::uuid,
      (v_service->>'staff_id')::uuid,
      (v_service->>'planned_price')::numeric,
      (select commission_rate from staff where id = (v_service->>'staff_id')::uuid)
    );
  end loop;

  return v_appointment_id;
end;
$$;
