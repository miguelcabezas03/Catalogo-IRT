/// <reference types="vite/client" />
import { createClient, type User } from '@supabase/supabase-js';

export type UserRole = 'admin' | 'viewer';
export type ReviewStatus =
  | 'Sin observaciones'
  | 'Sin revisar'
  | 'Borrosa'
  | 'Mala calidad'
  | 'Imagen incorrecta'
  | 'Incompleta'
  | 'Duplicada'
  | 'Otra';

export type CatalogImage = {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  folder: string;
  status: ReviewStatus;
  notes: string;
  updatedAt: string;
  createdDateTime: string;
  imageUrl?: string;
  storagePath?: string;
  isNew?: boolean;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isBackendConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isBackendConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const COUNTRY_BY_CODE: Record<string, string> = {
  AR: 'Argentina', BO: 'Bolivia', BR: 'Brasil', CL: 'Chile', CO: 'Colombia',
  CR: 'Costa Rica', DO: 'Rep. Dominicana', RD: 'Rep. Dominicana', EC: 'Ecuador',
  GT: 'Guatemala', HN: 'Honduras', MX: 'México', NI: 'Nicaragua', PA: 'Panamá',
  PE: 'Perú', PR: 'Puerto Rico', PY: 'Paraguay', SV: 'El Salvador', UY: 'Uruguay', VE: 'Venezuela',
};

function rowToImage(row: Record<string, unknown>, imageUrl?: string): CatalogImage {
  return {
    id: String(row.id),
    name: String(row.file_name),
    country: String(row.country),
    countryCode: String(row.country_code),
    folder: String(row.file_path).split('/').slice(0, -1).join(' / ') || String(row.country),
    status: row.review_status as ReviewStatus,
    notes: String(row.notes ?? ''),
    updatedAt: new Date(String(row.updated_at)).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
    createdDateTime: String(row.created_at),
    storagePath: String(row.storage_path),
    imageUrl,
    isNew: row.review_status === 'Sin revisar',
  };
}

async function loadAllCatalogRows(): Promise<Record<string, unknown>[]> {
  if (!supabase) return [];
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('catalog_images')
      .select('*')
      .order('file_name')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export async function signIn(username: string, password: string) {
  if (!supabase) throw new Error('Supabase todavía no está configurado.');
  const normalized = username.trim().toLowerCase();
  const email = normalized.includes('@') ? normalized : `${normalized}@irt.local`;
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}

export async function getCurrentUser(): Promise<{ user: User; role: UserRole } | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: profile, error } = await supabase.from('profiles').select('role').eq('id', data.user.id).single();
  if (error) throw error;
  return { user: data.user, role: profile.role as UserRole };
}

export async function loadCatalog(): Promise<CatalogImage[]> {
  if (!supabase) return [];
  const rows = await loadAllCatalogRows();
  if (!rows.length) return [];
  const signedByPath = new Map<string, string>();
  for (let index = 0; index < rows.length; index += 100) {
    const paths = rows.slice(index, index + 100).map((row) => String(row.storage_path));
    const { data: signed, error } = await supabase.storage.from('catalog-images').createSignedUrls(paths, 86400);
    if (error) throw error;
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }
  return rows.map((row) => rowToImage(row, signedByPath.get(String(row.storage_path))));
}

export async function saveReview(image: CatalogImage) {
  if (!supabase) return;
  const { error } = await supabase.rpc('save_catalog_review', {
    p_id: image.id,
    p_status: image.status,
    p_notes: image.notes,
  });
  if (error) throw error;
}

function inferCountry(path: string) {
  const parts = path.split('/').filter(Boolean);
  const filename = parts.at(-1) ?? path;
  const prefix = filename.match(/^([A-Za-z]{2})[_\- ]/)?.[1]?.toUpperCase();
  if (prefix && COUNTRY_BY_CODE[prefix]) return { code: prefix, country: COUNTRY_BY_CODE[prefix] };
  const folder = parts.slice(0, -1).find((part) => {
    const normalized = part.toLocaleLowerCase('es');
    return Object.values(COUNTRY_BY_CODE).some((name) => normalized.includes(name.toLocaleLowerCase('es')));
  });
  const match = folder && Object.entries(COUNTRY_BY_CODE).find(([, name]) => folder.toLocaleLowerCase('es').includes(name.toLocaleLowerCase('es')));
  return match ? { code: match[0], country: match[1] } : { code: prefix ?? 'OT', country: parts.at(-2) ?? 'Otro' };
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\./g, '').replace(/[^\p{L}\p{N}._\-/ ]/gu, '_');
}

export async function uploadCatalogFiles(files: File[], onProgress: (done: number, total: number) => void) {
  const client = supabase;
  if (!client) throw new Error('Supabase todavía no está configurado.');
  const configuredClient = client;
  const entries = files.filter((file) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name));
  if (!entries.length) throw new Error('La carpeta no contiene imágenes compatibles.');

  const existing = await loadAllCatalogRows();
  const existingByPath = new Map(existing.map((row) => [String(row.file_path), row]));
  const firstUpload = existingByPath.size === 0;

  const pendingRows: Record<string, unknown>[] = [];
  let cursor = 0;
  let completed = 0;

  async function uploadNext() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      const entry = entries[index];
      const originalPath = entry.webkitRelativePath || entry.name;
      const relativePath = normalizePath(originalPath.split('/').slice(1).join('/') || entry.name);
      const storagePath = `catalog/${relativePath}`;
      const previous = existingByPath.get(relativePath);
      const country = inferCountry(relativePath);
      const { error } = await configuredClient.storage.from('catalog-images').upload(storagePath, entry, {
        upsert: true,
        contentType: entry.type || undefined,
        cacheControl: '3600',
      });
      if (error) throw error;
      pendingRows.push({
        id: previous?.id ?? crypto.randomUUID(),
        file_name: relativePath.split('/').at(-1),
        file_path: relativePath,
        storage_path: storagePath,
        country: country.country,
        country_code: country.code,
        review_status: previous?.review_status ?? (firstUpload ? 'Sin observaciones' : 'Sin revisar'),
        notes: previous?.notes ?? '',
        updated_at: previous?.updated_at ?? new Date().toISOString(),
      });
      completed += 1;
      onProgress(completed, entries.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, () => uploadNext()));
  for (let index = 0; index < pendingRows.length; index += 200) {
    const { error } = await configuredClient.from('catalog_images').upsert(pendingRows.slice(index, index + 200), { onConflict: 'file_path' });
    if (error) throw error;
  }
  return entries.length;
}
