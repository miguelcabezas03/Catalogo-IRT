-- Ejecutar una sola vez en Supabase > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_images (
  id uuid primary key default gen_random_uuid(), file_name text not null, file_path text not null unique,
  storage_path text not null unique, country text not null, country_code text not null,
  review_status text not null default 'Sin revisar' check (review_status in ('Sin observaciones','Sin revisar','Borrosa','Mala calidad','Imagen incorrecta','Incompleta','Duplicada','Otra')),
  notes text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin insert into public.profiles (id, role) values (new.id, 'viewer') on conflict (id) do nothing; return new; end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.catalog_images enable row level security;
create policy "Usuarios ven su perfil" on public.profiles for select to authenticated using (id = auth.uid());
create policy "Usuarios leen catalogo" on public.catalog_images for select to authenticated using (true);
create policy "Admin inserta catalogo" on public.catalog_images for insert to authenticated with check ((select role from public.profiles where id = auth.uid()) = 'admin');
create policy "Admin actualiza catalogo" on public.catalog_images for update to authenticated using ((select role from public.profiles where id = auth.uid()) = 'admin') with check ((select role from public.profiles where id = auth.uid()) = 'admin');
create policy "Admin elimina catalogo" on public.catalog_images for delete to authenticated using ((select role from public.profiles where id = auth.uid()) = 'admin');

insert into storage.buckets (id, name, public) values ('catalog-images', 'catalog-images', false) on conflict (id) do update set public = false;
create policy "Usuarios ven imagenes" on storage.objects for select to authenticated using (bucket_id = 'catalog-images');
create policy "Admin sube imagenes" on storage.objects for insert to authenticated with check (bucket_id = 'catalog-images' and (select role from public.profiles where id = auth.uid()) = 'admin');
create policy "Admin reemplaza imagenes" on storage.objects for update to authenticated using (bucket_id = 'catalog-images' and (select role from public.profiles where id = auth.uid()) = 'admin');
create policy "Admin elimina imagenes" on storage.objects for delete to authenticated using (bucket_id = 'catalog-images' and (select role from public.profiles where id = auth.uid()) = 'admin');

-- Después de crear las cuentas en Authentication > Users, asignar el administrador:
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'CORREO_ADMIN');
-- La segunda cuenta queda automáticamente con role = 'viewer'.
