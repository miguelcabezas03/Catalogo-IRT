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
  with check ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local');

drop policy if exists "Databricks can update audit sessions" on public.audit_validation_sessions;
create policy "Databricks can update audit sessions"
  on public.audit_validation_sessions for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local')
  with check ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local');

drop policy if exists "Databricks can delete audit sessions" on public.audit_validation_sessions;
create policy "Databricks can delete audit sessions"
  on public.audit_validation_sessions for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local');

drop policy if exists "Databricks can insert audit images" on public.audit_validation_images;
create policy "Databricks can insert audit images"
  on public.audit_validation_images for insert
  to authenticated
  with check ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local');

drop policy if exists "Databricks can update audit images" on public.audit_validation_images;
create policy "Databricks can update audit images"
  on public.audit_validation_images for update
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local')
  with check ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local');

drop policy if exists "Databricks can delete audit images" on public.audit_validation_images;
create policy "Databricks can delete audit images"
  on public.audit_validation_images for delete
  to authenticated
  using ((auth.jwt() ->> 'email') = 'databricks-sync@irt.local');

grant select on public.audit_validation_sessions to authenticated;
grant select on public.audit_validation_images to authenticated;
grant insert, update, delete on public.audit_validation_sessions to authenticated;
grant insert, update, delete on public.audit_validation_images to authenticated;

comment on table public.audit_validation_sessions is
  'Auditorías sincronizadas desde storeview.slv_sv_ceres_ag_export.';
comment on table public.audit_validation_images is
  'Imágenes asociadas por ID_de_audito = RU03_InterviewID.';
