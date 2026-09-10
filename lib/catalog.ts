import { createClient, type User } from '@supabase/supabase-js';
import JSZip from 'jszip';

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

const runtimeEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const supabaseUrl = runtimeEnv.VITE_SUPABASE_URL;
const supabaseAnonKey = runtimeEnv.VITE_SUPABASE_ANON_KEY;

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

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Supabase todavía no está configurado.');
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
  const { data, error } = await supabase.from('catalog_images').select('*').order('file_name');
  if (error) throw error;
  if (!data?.length) return [];
  const paths = data.map((row) => row.storage_path);
  const { data: signed, error: signedError } = await supabase.storage.from('catalog-images').createSignedUrls(paths, 3600);
  if (signedError) throw signedError;
  return data.map((row, index) => rowToImage(row, signed[index]?.signedUrl ?? undefined));
}

export async function saveReview(image: CatalogImage) {
  if (!supabase) return;
  const { error } = await supabase.from('catalog_images').update({
    review_status: image.status,
    notes: image.notes,
    updated_at: new Date().toISOString(),
  }).eq('id', image.id);
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

export async function uploadCatalogZip(file: File, onProgress: (done: number, total: number) => void) {
  if (!supabase) throw new Error('Supabase todavía no está configurado.');
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(entry.name));
  if (!entries.length) throw new Error('El ZIP no contiene imágenes compatibles.');

  const { data: existing, error: existingError } = await supabase.from('catalog_images').select('*');
  if (existingError) throw existingError;
  const existingByPath = new Map((existing ?? []).map((row) => [row.file_path, row]));
  const firstUpload = existingByPath.size === 0;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const relativePath = normalizePath(entry.name);
    const storagePath = `catalog/${relativePath}`;
    const blob = await entry.async('blob');
    const previous = existingByPath.get(relativePath);
    const country = inferCountry(relativePath);
    const { error: storageError } = await supabase.storage.from('catalog-images').upload(storagePath, blob, {
      upsert: true,
      contentType: blob.type || undefined,
      cacheControl: '3600',
    });
    if (storageError) throw storageError;
    const { error: rowError } = await supabase.from('catalog_images').upsert({
      id: previous?.id ?? crypto.randomUUID(),
      file_name: relativePath.split('/').at(-1),
      file_path: relativePath,
      storage_path: storagePath,
      country: country.country,
      country_code: country.code,
      review_status: previous?.review_status ?? (firstUpload ? 'Sin observaciones' : 'Sin revisar'),
      notes: previous?.notes ?? '',
      updated_at: previous?.updated_at ?? new Date().toISOString(),
    }, { onConflict: 'file_path' });
    if (rowError) throw rowError;
    onProgress(index + 1, entries.length);
  }
  return entries.length;
}
