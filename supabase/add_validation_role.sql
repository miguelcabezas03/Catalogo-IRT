-- Agrega el perfil VALIDACION de solo lectura a una instalación existente.
-- 1. Cree validacion@irt.local en Authentication > Users (Auto Confirm User activado).
-- 2. Ejecute este archivo completo en Supabase > SQL Editor.

begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'viewer', 'validation'));

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, case when lower(new.email) = 'validacion@irt.local' then 'validation' else 'viewer' end)
  on conflict (id) do nothing;
  return new;
end;
$$;

update public.profiles
set role = 'validation'
where id = (
  select id from auth.users where lower(email) = 'validacion@irt.local'
);

drop policy if exists "Admin elimina catalogo" on public.catalog_images;
drop policy if exists "Usuarios eliminan catalogo" on public.catalog_images;
create policy "Usuarios eliminan catalogo"
  on public.catalog_images
  for delete
  to authenticated
  using ((select role from public.profiles where id = auth.uid()) in ('admin', 'viewer'));

drop policy if exists "Admin elimina imagenes" on storage.objects;
drop policy if exists "Usuarios eliminan imagenes" on storage.objects;
create policy "Usuarios eliminan imagenes"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'catalog-images'
    and (select role from public.profiles where id = auth.uid()) in ('admin', 'viewer')
  );

create or replace function public.save_catalog_review(p_id uuid, p_status text, p_notes text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select role from public.profiles where id = auth.uid()), '') not in ('admin', 'viewer') then
    raise exception 'Usuario no autorizado para modificar revisiones';
  end if;

  update public.catalog_images
  set review_status = p_status,
      notes = coalesce(p_notes, ''),
      updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.save_catalog_review(uuid, text, text) from public;
grant execute on function public.save_catalog_review(uuid, text, text) to authenticated;

commit;
