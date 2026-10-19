-- Vista de auditorías exclusiva para el perfil VALIDACION.
-- Ejecutar una vez en Supabase > SQL Editor.

create table if not exists public.audit_validation_sessions (
  audit_id text primary key,
  image_count integer not null default 0 check (image_count >= 0),
  audit_data jsonb not null default '{}'::jsonb,
  sync_id uuid not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_validation_images (
  image_key text primary key,
  audit_id text not null references public.audit_validation_sessions(audit_id) on delete cascade,
  image_url text not null,
  sync_id uuid not null,
  updated_at timestamptz not null default now()
);

create index if not exists audit_validation_images_audit_id_idx
  on public.audit_validation_images (audit_id);

-- La sincronización elimina por sync_id. Sin estos índices PostgreSQL debe
-- recorrer las tablas completas en cada lote y puede agotar el timeout.
create index if not exists audit_validation_sessions_sync_id_idx
  on public.audit_validation_sessions (sync_id);

create index if not exists audit_validation_images_sync_id_idx
  on public.audit_validation_images (sync_id);

alter table public.audit_validation_sessions enable row level security;
alter table public.audit_validation_images enable row level security;

drop policy if exists "Authenticated users can read audit sessions" on public.audit_validation_sessions;
create policy "Authenticated users can read audit sessions"
  on public.audit_validation_sessions for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can read audit images" on public.audit_validation_images;
create policy "Authenticated users can read audit images"
  on public.audit_validation_images for select
  to authenticated
  using (true);

-- La cuenta técnica de Databricks es la única que puede sincronizar estas tablas.
drop policy if exists "Databricks can insert audit sessions" on public.audit_validation_sessions;
create policy "Databricks can insert audit sessions"
  on public.audit_validation_sessions for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local');

drop policy if exists "Databricks can update audit sessions" on public.audit_validation_sessions;
create policy "Databricks can update audit sessions"
  on public.audit_validation_sessions for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local')
  with check ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local');

drop policy if exists "Databricks can delete audit sessions" on public.audit_validation_sessions;
create policy "Databricks can delete audit sessions"
  on public.audit_validation_sessions for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local');

drop policy if exists "Databricks can insert audit images" on public.audit_validation_images;
create policy "Databricks can insert audit images"
  on public.audit_validation_images for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local');

drop policy if exists "Databricks can update audit images" on public.audit_validation_images;
create policy "Databricks can update audit images"
  on public.audit_validation_images for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local')
  with check ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local');

drop policy if exists "Databricks can delete audit images" on public.audit_validation_images;
create policy "Databricks can delete audit images"
  on public.audit_validation_images for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-audit-sync@irt.local');

grant select on public.audit_validation_sessions to authenticated;
grant select on public.audit_validation_images to authenticated;
grant insert, update, delete on public.audit_validation_sessions to authenticated;
grant insert, update, delete on public.audit_validation_images to authenticated;

-- Limpia un solo lote por llamada. Databricks repite la llamada hasta que
-- ambos contadores lleguen a cero, de modo que cada transacción permanezca
-- por debajo del timeout de Supabase/PostgREST. Se usa un nombre nuevo para
-- conservar la función anterior hasta comprobar el flujo actualizado.
create or replace function public.cleanup_audit_validation_batch(p_sync_id uuid)
returns table(images_deleted integer, sessions_deleted integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_images integer := 0;
  deleted_sessions integer := 0;
begin
  if coalesce(auth.jwt() ->> 'email', '') <> 'databricks-audit-sync@irt.local' then
    raise exception 'Usuario no autorizado para limpiar auditorías';
  end if;

  with doomed as (
    select image_key
    from public.audit_validation_images
    where sync_id <> p_sync_id
    limit 500
  )
  delete from public.audit_validation_images target
  using doomed
  where target.image_key = doomed.image_key;
  get diagnostics deleted_images = row_count;

  with doomed as (
    select audit_id
    from public.audit_validation_sessions
    where sync_id <> p_sync_id
    limit 100
  )
  delete from public.audit_validation_sessions target
  using doomed
  where target.audit_id = doomed.audit_id;
  get diagnostics deleted_sessions = row_count;

  return query select deleted_images, deleted_sessions;
end;
$$;

revoke all on function public.cleanup_audit_validation_batch(uuid) from public;
grant execute on function public.cleanup_audit_validation_batch(uuid) to authenticated;

comment on table public.audit_validation_sessions is
  'Auditorías sincronizadas desde storeview.slv_sv_ceres_ag_export.';
comment on table public.audit_validation_images is
  'Imágenes asociadas por ID_de_audito = RU03_InterviewID.';
