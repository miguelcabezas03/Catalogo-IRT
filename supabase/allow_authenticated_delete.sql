-- Permite eliminar una imagen desde cualquiera de los dos perfiles del catálogo.
-- Ejecutar una sola vez en Supabase > SQL Editor.

drop policy if exists "Admin elimina catalogo" on public.catalog_images;
drop policy if exists "Usuarios eliminan catalogo" on public.catalog_images;
create policy "Usuarios eliminan catalogo"
  on public.catalog_images
  for delete
  to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()));

drop policy if exists "Admin elimina imagenes" on storage.objects;
drop policy if exists "Usuarios eliminan imagenes" on storage.objects;
create policy "Usuarios eliminan imagenes"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'catalog-images'
    and exists (select 1 from public.profiles where id = auth.uid())
  );
