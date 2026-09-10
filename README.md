# Revisión IRT

Aplicación para sincronizar una carpeta de imágenes del computador, buscar por nombre, filtrar por país y observación, revisar hallazgos y descargar el resultado en Excel.

## Permisos

- **Administrador:** selecciona o actualiza la carpeta del catálogo, cambia estados, escribe observaciones y marca imágenes correctas.
- **Visualizador:** busca, filtra, abre imágenes, guarda observaciones y descarga Excel. No puede sincronizar carpetas.

Las contraseñas no se guardan en GitHub. La autenticación, las imágenes y las observaciones se almacenan en Supabase.

## Configuración inicial

1. Crear un proyecto gratuito en Supabase.
2. Abrir **SQL Editor**, copiar y ejecutar [`supabase/setup.sql`](supabase/setup.sql).
3. En **Authentication → Users**, crear `admin@irt.local` y `visualizador@irt.local`, cada uno con su propia contraseña y confirmación automática. En la página se inicia sesión usando solamente `admin` o `visualizador`.
4. Ejecutar esta instrucción en **SQL Editor** para asignar el rol administrador:

   ```sql
   update public.profiles
   set role = 'admin'
   where id = (select id from auth.users where email = 'admin@irt.local');
   ```

   La cuenta `visualizador@irt.local` queda automáticamente con el rol `viewer`. Si la versión anterior de la base de datos ya estaba configurada, ejecutar también [`supabase/upgrade_shared_reviews.sql`](supabase/upgrade_shared_reviews.sql).
5. En GitHub abrir **Settings → Secrets and variables → Actions → Variables** y crear:
   - `SUPABASE_URL`: Project Settings → API → Project URL.
   - `SUPABASE_ANON_KEY`: Project Settings → API → anon/public key. Esta clave es pública; nunca usar la `service_role` en GitHub.
6. En **Settings → Pages**, elegir **GitHub Actions** como fuente de publicación.

La primera sincronización deja las imágenes en **Sin observaciones**. En sincronizaciones posteriores, las imágenes nuevas quedan en **Sin revisar** y las ya existentes conservan su observación. Los cambios de ambos perfiles se actualizan en tiempo real y el Excel usa el estado visible más reciente.

Por seguridad del navegador no se puede guardar una ruta como `C:\Catalogos` ni leerla sin permiso permanente. El administrador elige la carpeta completa desde **Seleccionar carpeta** cada vez que quiera sincronizarla; la aplicación copia únicamente las imágenes a Supabase. Así el visualizador puede abrirlas aunque el computador del administrador esté apagado.

## Desarrollo local

Copiar `.env.example` como `.env.local`, completar los datos públicos de Supabase y ejecutar `pnpm dev`. Sin esas variables, la aplicación abre un modo de demostración para comprobar ambos roles.
