-- Ejecutar si setup.sql ya se había aplicado anteriormente.
create or replace function public.save_catalog_review(p_id uuid, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Usuario no autorizado';
  end if;
  update public.catalog_images
  set review_status = p_status, notes = coalesce(p_notes, ''), updated_at = now()
  where id = p_id;
end;
$$;

revoke all on function public.save_catalog_review(uuid, text, text) from public;
grant execute on function public.save_catalog_review(uuid, text, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'catalog_images') then
    alter publication supabase_realtime add table public.catalog_images;
  end if;
end $$;
