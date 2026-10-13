-- Permite eliminar una imagen únicamente a Administrador y Visualizador.
-- Ejecutar una sola vez en Supabase > SQL Editor.

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
