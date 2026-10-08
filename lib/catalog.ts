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
  imageCode: string;
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
  studies: string[];
  brands: string[];
  masterNames: string[];
};

export const NO_STUDY = 'Sin estudio identificado';

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

const FOLDER_ALIASES: Record<string, { code: string; country: string }> = {
  CV: { code: 'CL', country: 'Chile' },
  CRUZVERDE: { code: 'CL', country: 'Chile' },
};

function normalizeImageCode(value: string) {
  const filename = value.replace(/\\/g, '/').split('/').at(-1) ?? value;
  return filename
    .trim()
    .replace(/\.(jpe?g|png|webp|gif|bmp|avif)$/i, '')
    .replace(/(?:_\d+)+_*$/i, '')
    .toUpperCase();
}

type ImageMetadata = { studies: string[]; brands: string[]; names: string[] };

function rowToImage(row: Record<string, unknown>, metadata: ImageMetadata = { studies: [], brands: [], names: [] }, imageUrl?: string): CatalogImage {
  const name = String(row.file_name);
  const filePath = String(row.file_path);
  const pathParts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const folderName = pathParts.length > 1 ? pathParts[0].trim() : '';
  const filenamePrefix = name.match(/^([A-Za-z]{2})/)?.[1]?.toUpperCase();
  const folderLocation = folderName ? countryFromFolder(folderName) : null;
  const prefixAlias = filenamePrefix ? FOLDER_ALIASES[filenamePrefix] : undefined;
  const displayedCountry = folderLocation?.country || folderName || prefixAlias?.country || String(row.country);
  return {
    id: String(row.id),
    name,
    imageCode: normalizeImageCode(name),
    country: displayedCountry,
    countryCode: folderLocation?.code || prefixAlias?.code || String(row.country_code),
    folder: pathParts.slice(0, -1).join(' / ') || displayedCountry,
    status: row.review_status as ReviewStatus,
    notes: String(row.notes ?? ''),
    updatedAt: new Date(String(row.updated_at)).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }),
    createdDateTime: String(row.created_at),
    storagePath: String(row.storage_path),
    imageUrl,
    isNew: row.review_status === 'Sin revisar',
    studies: metadata.studies,
    brands: metadata.brands,
    masterNames: metadata.names,
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

async function loadStudyMap(): Promise<Map<string, ImageMetadata>> {
  const studyMap = new Map<string, { studies: Set<string>; brands: Set<string>; names: Set<string> }>();
  if (!supabase) return new Map();
  const pageSize = 1000;
  const addRows = (rows: { codigo_imagen: unknown; estudio: unknown; marca: unknown; nombre: unknown }[]) => {
    for (const row of rows) {
      const code = normalizeImageCode(String(row.codigo_imagen ?? ''));
      const study = String(row.estudio ?? '').trim();
      const brand = String(row.marca ?? '').trim();
      const name = String(row.nombre ?? '').trim();
      if (!code || !study) continue;
      const metadata = studyMap.get(code) ?? { studies: new Set<string>(), brands: new Set<string>(), names: new Set<string>() };
      metadata.studies.add(study);
      if (brand) metadata.brands.add(brand);
      if (name) metadata.names.add(name);
      studyMap.set(code, metadata);
    }
  };

  const firstResult = await supabase
    .from('imagen_estudios')
    .select('codigo_imagen,estudio,marca,nombre', { count: 'exact' })
    .order('codigo_imagen')
    .order('estudio')
    .range(0, pageSize - 1);
  if (firstResult.error) throw firstResult.error;
  addRows(firstResult.data ?? []);

  const total = firstResult.count ?? firstResult.data?.length ?? 0;
  const concurrentPages = 6;
  for (let batchStart = pageSize; batchStart < total; batchStart += pageSize * concurrentPages) {
    const offsets = Array.from(
      { length: Math.min(concurrentPages, Math.ceil((total - batchStart) / pageSize)) },
      (_, index) => batchStart + index * pageSize,
    );
    const results = await Promise.all(offsets.map((from) => supabase
      .from('imagen_estudios')
      .select('codigo_imagen,estudio,marca,nombre')
      .order('codigo_imagen')
      .order('estudio')
      .range(from, from + pageSize - 1)));
    for (const result of results) {
      if (result.error) throw result.error;
      addRows(result.data ?? []);
    }
  }

  return new Map(Array.from(studyMap, ([code, metadata]) => [code, {
    studies: Array.from(metadata.studies).sort(),
    brands: Array.from(metadata.brands).sort(),
    names: Array.from(metadata.names).sort(),
  }]));
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
  const [rows, studyMap] = await Promise.all([loadAllCatalogRows(), loadStudyMap()]);
  return rows.map((row) => {
    const code = normalizeImageCode(String(row.file_name));
    return rowToImage(row, studyMap.get(code));
  });
}

export async function hydrateImageUrls(images: CatalogImage[], expiresIn = 86400): Promise<CatalogImage[]> {
  if (!supabase || !images.length) return images;
  const signedByPath = new Map<string, string>();
  for (let index = 0; index < images.length; index += 100) {
    const paths = images.slice(index, index + 100).map((image) => String(image.storagePath));
    const { data: signed, error } = await supabase.storage.from('catalog-images').createSignedUrls(paths, expiresIn);
    if (error) throw error;
    for (const item of signed ?? []) {
      if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
    }
  }
  return images.map((image) => ({ ...image, imageUrl: signedByPath.get(String(image.storagePath)) ?? image.imageUrl }));
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

export async function deleteCatalogImage(image: CatalogImage) {
  if (!supabase) return;
  if (!image.storagePath) throw new Error('La imagen no tiene una ruta de almacenamiento válida.');

  const { error: storageError } = await supabase.storage
    .from('catalog-images')
    .remove([image.storagePath]);
  if (storageError) throw storageError;

  const { error: rowError } = await supabase
    .from('catalog_images')
    .delete()
    .eq('id', image.id);
  if (rowError) throw rowError;
}

function countryToken(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function countryFromFolder(folder: string) {
  const token = countryToken(folder);
  if (FOLDER_ALIASES[token]) return FOLDER_ALIASES[token];
  if (COUNTRY_BY_CODE[token]) return { code: token, country: COUNTRY_BY_CODE[token] };
  const match = Object.entries(COUNTRY_BY_CODE).find(([, name]) => countryToken(name) === token);
  if (match) return { code: match[0], country: match[1] };
  if (['DOMINICANA', 'REPUBLICADOMINICANA'].includes(token)) return { code: 'RD', country: COUNTRY_BY_CODE.RD };
  return null;
}

function inferCountry(path: string) {
  const parts = path.split('/').filter(Boolean);
  const filename = parts.at(-1) ?? path;
  const folder = parts.length > 1 ? parts[0].trim() : '';
  const folderLocation = folder ? countryFromFolder(folder) : null;
  const prefixCandidate = filename.match(/^([A-Za-z]{2})/)?.[1]?.toUpperCase();
  const prefixLocation = prefixCandidate
    ? FOLDER_ALIASES[prefixCandidate] ?? (COUNTRY_BY_CODE[prefixCandidate] ? { code: prefixCandidate, country: COUNTRY_BY_CODE[prefixCandidate] } : null)
    : null;
  if (folder) return { code: folderLocation?.code ?? prefixLocation?.code ?? 'OT', country: folderLocation?.country ?? folder };
  return prefixLocation ?? { code: 'OT', country: 'Otro' };
}

function normalizePath(path: string) {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
    .replace(/[^\p{L}\p{N}._\-/ ]/gu, '_')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/');
}

function toStorageKey(path: string) {
  return path
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._\-/]/g, '_')
    .replace(/_+/g, '_');
}

function relativeCatalogPath(originalPath: string, fallbackName: string, preserveSelectedFolder: boolean) {
  const parts = normalizePath(originalPath).split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || fallbackName;
  const relativeParts = preserveSelectedFolder ? parts : parts.slice(1);
  const folderLocation = relativeParts[0] ? countryFromFolder(relativeParts[0]) : null;
  if (folderLocation) relativeParts[0] = folderLocation.country;
  return relativeParts.join('/') || fallbackName;
}

export async function uploadCatalogFiles(files: File[], onProgress: (done: number, total: number) => void) {
  const client = supabase;
  if (!client) throw new Error('Supabase todavía no está configurado.');
  const configuredClient = client;
  const entries = files.filter((file) => /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name));
  if (!entries.length) throw new Error('La carpeta no contiene imágenes compatibles.');

  const firstPathParts = normalizePath(entries[0].webkitRelativePath || entries[0].name).split('/').filter(Boolean);
  const selectedFolder = firstPathParts.length > 1 ? firstPathParts[0] : '';
  const containsSubfolders = entries.some((entry) => normalizePath(entry.webkitRelativePath || entry.name).split('/').filter(Boolean).length > 2);
  // Una carpeta reconocida (incluida Cruz Verde/Chile) puede subirse sola y debe conservar
  // su nombre. Si se selecciona el catálogo general, se quita únicamente ese nivel.
  const preserveSelectedFolder = Boolean(countryFromFolder(selectedFolder)) || !containsSubfolders;

  const existing = await loadAllCatalogRows();
  const existingByPath = new Map(existing.map((row) => [String(row.file_path), row]));
  const firstUpload = existingByPath.size === 0;

  let completed = 0;
  const failedFiles: string[] = [];

  for (let batchStart = 0; batchStart < entries.length; batchStart += 100) {
    const batch = entries.slice(batchStart, batchStart + 100);
    const pendingRows: Record<string, unknown>[] = [];
    let cursor = 0;

    async function uploadNext() {
      while (cursor < batch.length) {
        const index = cursor;
        cursor += 1;
        const entry = batch[index];
        const originalPath = entry.webkitRelativePath || entry.name;
        const relativePath = relativeCatalogPath(originalPath, entry.name, preserveSelectedFolder);
        const storagePath = `catalog/${toStorageKey(relativePath)}`;
        const previous = existingByPath.get(relativePath);
        const country = inferCountry(relativePath);
        let uploadError: Error | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const { error } = await configuredClient.storage.from('catalog-images').upload(storagePath, entry, {
            upsert: true,
            contentType: entry.type || undefined,
            cacheControl: '3600',
          });
          if (!error) { uploadError = null; break; }
          uploadError = error;
          if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 400 * (attempt + 1)));
        }
        if (uploadError) {
          failedFiles.push(`${relativePath}: ${uploadError.message}`);
        } else {
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
        }
        completed += 1;
        onProgress(completed, entries.length);
      }
    }

    await Promise.all(Array.from({ length: Math.min(4, batch.length) }, () => uploadNext()));
    if (pendingRows.length) {
      const { error } = await configuredClient.from('catalog_images').upsert(pendingRows, { onConflict: 'file_path' });
      if (error) throw error;
    }
  }
  return { processed: entries.length - failedFiles.length, failed: failedFiles.length, firstError: failedFiles[0] };
}
