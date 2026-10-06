-- Tabla alimentada por el cuaderno de Databricks.
-- Ejecutar una sola vez en Supabase > SQL Editor.
create table if not exists public.imagen_estudios (
  codigo_imagen text not null,
  estudio text not null,
  pais text,
  categoria text,
  nombre text,
  tabla_origen text,
  sincronizacion_id uuid not null,
  fecha_sincronizacion timestamptz not null default now(),
  primary key (codigo_imagen, estudio)
);

create index if not exists imagen_estudios_codigo_idx
  on public.imagen_estudios (codigo_imagen);
create index if not exists imagen_estudios_estudio_idx
  on public.imagen_estudios (estudio);

alter table public.imagen_estudios enable row level security;

drop policy if exists "Usuarios leen estudios" on public.imagen_estudios;
create policy "Usuarios leen estudios"
  on public.imagen_estudios for select to authenticated
  using (true);

-- La cuenta técnica de Databricks necesita políticas separadas de
-- INSERT, UPDATE y DELETE limitadas a su auth.uid(). No se incluye ese UUID
-- aquí para evitar copiar una identidad propia de un ambiente a otro.
