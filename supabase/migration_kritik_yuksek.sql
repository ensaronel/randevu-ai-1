-- Bu dosya, PLAN_kritik_yuksek_duzeltmeler.md'deki Grup B (veritabanı bütünlüğü)
-- değişikliklerini içerir. supabase/schema.sql'in güncel hâli zaten bu iki
-- fonksiyonu içeriyor — bu dosya sadece Supabase SQL Editor'e kolay
-- yapıştırmak için ayrı çıkarıldı. Çalıştırdıktan sonra silinebilir.

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

  -- customer_id ve p_services içindeki service_id/staff_id'lerin GERÇEKTEN bu
  -- işletmeye ait olduğunu doğrula.
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

  -- Çakışma kontrolü ile insert arasında yarış durumu oluşmasın diye, ilgili
  -- her personel için transaction bazlı advisory lock alınır (sıralı, deadlock
  -- önler; transaction bitince otomatik düşer).
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
    insert into appointment_services (appointment_id, service_id, staff_id, planned_price)
    values (
      v_appointment_id,
      (v_service->>'service_id')::uuid,
      (v_service->>'staff_id')::uuid,
      (v_service->>'planned_price')::numeric
    );
  end loop;

  return v_appointment_id;
end;
$$;

create or replace function reschedule_appointment_with_check(
  p_appointment_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns void
language plpgsql
security invoker
as $$
declare
  v_business_id uuid := current_business_id();
  v_staff_id uuid;
  v_conflict_count int;
begin
  if v_business_id is null then
    raise exception 'unauthorized';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  if not exists (
    select 1 from appointments where id = p_appointment_id and business_id = v_business_id
  ) then
    raise exception 'not_found';
  end if;

  for v_staff_id in
    select distinct staff_id from appointment_services
    where appointment_id = p_appointment_id
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtext(v_staff_id::text));
  end loop;

  select count(*) into v_conflict_count
  from appointment_services asvc
  join appointments a on a.id = asvc.appointment_id
  where a.business_id = v_business_id
    and a.id != p_appointment_id
    and a.status != 'cancelled'
    and asvc.staff_id in (
      select staff_id from appointment_services where appointment_id = p_appointment_id
    )
    and a.starts_at < p_ends_at
    and a.ends_at > p_starts_at;

  if v_conflict_count > 0 then
    raise exception 'staff_conflict';
  end if;

  update appointments
  set starts_at = p_starts_at, ends_at = p_ends_at, updated_at = now()
  where id = p_appointment_id and business_id = v_business_id;
end;
$$;
