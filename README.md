# Revisión IRT

Aplicación para cargar un catálogo de imágenes desde ZIP, buscar por nombre, filtrar por país y observación, revisar hallazgos y descargar el resultado en Excel.

## Permisos

- **Administrador:** sube o actualiza el catálogo ZIP, cambia estados, escribe observaciones y marca imágenes correctas.
- **Visualizador:** busca, filtra, abre imágenes y descarga Excel. No puede cargar ni editar.

Las contraseñas no se guardan en GitHub. La autenticación, las imágenes y las observaciones se almacenan en Supabase.

## Configuración inicial

1. Crear un proyecto gratuito en Supabase.
2. Abrir **SQL Editor**, copiar y ejecutar [`supabase/setup.sql`](supabase/setup.sql).
3. En **Authentication → Users**, crear dos usuarios con correo y contraseña: uno administrador y otro visualizador.
4. Ejecutar al final del SQL la instrucción comentada `update public.profiles...`, reemplazando `CORREO_ADMIN` por el correo real del administrador. El otro usuario queda como `viewer`.
5. En GitHub abrir **Settings → Secrets and variables → Actions → Variables** y crear:
   - `SUPABASE_URL`: Project Settings → API → Project URL.
   - `SUPABASE_ANON_KEY`: Project Settings → API → anon/public key. Esta clave es pública; nunca usar la `service_role` en GitHub.
6. En **Settings → Pages**, elegir **GitHub Actions** como fuente de publicación.

La primera carga deja las imágenes en **Sin observaciones**. En las cargas posteriores, las imágenes nuevas quedan en **Sin revisar** y las ya existentes conservan su observación.

## Desarrollo local

Copiar `.env.example` como `.env.local`, completar los datos públicos de Supabase y ejecutar `pnpm dev`. Sin esas variables, la aplicación abre un modo de demostración para comprobar ambos roles.
