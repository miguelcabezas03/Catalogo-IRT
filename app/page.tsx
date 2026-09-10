'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Download, Expand, FileArchive, FileImage, ImageIcon, LoaderCircle, LogOut, Search, ShieldCheck, Sparkles, Upload, UserRound, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { type CatalogImage, type ReviewStatus, type UserRole, getCurrentUser, isBackendConfigured, loadCatalog, saveReview as saveCatalogReview, signIn, signOut, supabase, uploadCatalogZip } from '@/lib/catalog';

const REVIEW_OPTIONS: ReviewStatus[] = ['Sin observaciones', 'Sin revisar', 'Borrosa', 'Mala calidad', 'Imagen incorrecta', 'Incompleta', 'Duplicada', 'Otra'];
const DEMO_IMAGES: CatalogImage[] = [
  { id: '1', name: 'CL_IMG001.jpg', country: 'Chile', countryCode: 'CL', folder: 'Chile / Bebidas', status: 'Sin observaciones', notes: '', updatedAt: 'Hoy, 09:42', createdDateTime: '2026-09-01T14:00:00Z' },
  { id: '2', name: 'CR_IMG014.png', country: 'Costa Rica', countryCode: 'CR', folder: 'Costa Rica / Alimentos', status: 'Borrosa', notes: 'La etiqueta no se alcanza a leer con claridad.', updatedAt: 'Hoy, 09:31', createdDateTime: '2026-09-01T14:00:00Z' },
  { id: '3', name: 'RD_IMG008.jpg', country: 'Rep. Dominicana', countryCode: 'RD', folder: 'Rep. Dominicana / Cuidado personal', status: 'Sin observaciones', notes: '', updatedAt: 'Ayer, 16:18', createdDateTime: '2026-09-01T14:00:00Z' },
  { id: '4', name: 'SV_IMG021.jpg', country: 'El Salvador', countryCode: 'SV', folder: 'El Salvador / Bebidas', status: 'Mala calidad', notes: 'Tiene compresión y pérdida de detalle.', updatedAt: 'Ayer, 15:54', createdDateTime: '2026-09-01T14:00:00Z' },
  { id: '5', name: 'GT_IMG032.jpg', country: 'Guatemala', countryCode: 'GT', folder: 'Guatemala / Alimentos', status: 'Sin revisar', notes: '', updatedAt: 'Nuevo', isNew: true, createdDateTime: '2026-09-08T14:00:00Z' },
];

function statusTone(status: ReviewStatus) {
  if (status === 'Sin observaciones') return 'good';
  if (status === 'Sin revisar') return 'pending';
  return 'issue';
}

export default function Home() {
  const [images, setImages] = useState<CatalogImage[]>([]);
  const [role, setRole] = useState<UserRole | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(isBackendConfigured);
  const [userEmail, setUserEmail] = useState('');
  const [query, setQuery] = useState('');
  const [country, setCountry] = useState('Todos');
  const [status, setStatus] = useState('Todas');
  const [selected, setSelected] = useState<CatalogImage | null>(null);
  const [draftStatus, setDraftStatus] = useState<ReviewStatus>('Sin observaciones');
  const [draftNotes, setDraftNotes] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
  const isAdmin = role === 'admin';

  useEffect(() => {
    if (!isBackendConfigured) { setAuthLoading(false); return; }
    let active = true;
    async function restoreSession() {
      try {
        const current = await getCurrentUser();
        if (active && current) {
          setRole(current.role); setUserEmail(current.user.email ?? 'Usuario');
          setImages(await loadCatalog());
        }
      } catch (error) { if (active) showNotice(error instanceof Error ? error.message : 'No se pudo abrir la sesión.', true); }
      finally { if (active) setAuthLoading(false); }
    }
    void restoreSession();
    const listener = supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { setRole(null); setImages([]); } });
    return () => { active = false; listener?.data.subscription.unsubscribe(); };
  }, []);

  const countries = useMemo(() => ['Todos', ...Array.from(new Set(images.map((item) => item.country)))], [images]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return images.filter((item) => (!normalized || item.name.toLowerCase().includes(normalized)) && (country === 'Todos' || item.country === country) && (status === 'Todas' || item.status === status));
  }, [country, images, query, status]);
  const counts = useMemo(() => ({ total: images.length, correct: images.filter((item) => item.status === 'Sin observaciones').length, pending: images.filter((item) => item.status === 'Sin revisar').length, issues: images.filter((item) => !['Sin observaciones', 'Sin revisar'].includes(item.status)).length }), [images]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({ name: 'get_catalog_summary', title: 'Consultar resumen del catálogo', description: 'Devuelve el total de imágenes y sus estados actuales sin modificar datos.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ ...counts, visible: filtered.length, countryFilter: country, observationFilter: status }) }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [counts, country, filtered.length, status]);

  function showNotice(message: string, error = false) {
    setNotice(message); setErrorNotice(error);
    window.setTimeout(() => setNotice(''), 3600);
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault(); setAuthLoading(true);
    try {
      const user = await signIn(email, password);
      const current = await getCurrentUser();
      if (!current) throw new Error('No encontramos el perfil de este usuario.');
      setRole(current.role); setUserEmail(user?.email ?? email); setImages(await loadCatalog()); setPassword('');
    } catch (error) { showNotice(error instanceof Error ? error.message : 'No fue posible iniciar sesión.', true); }
    finally { setAuthLoading(false); }
  }

  async function handleLogout() { await signOut(); setRole(null); setImages([]); setUserEmail(''); }
  function enterDemo(demoRole: UserRole) { setRole(demoRole); setUserEmail(demoRole === 'admin' ? 'admin@demo.local' : 'visualizador@demo.local'); setImages(DEMO_IMAGES); }
  function openImage(item: CatalogImage) { setSelected(item); setDraftStatus(item.status); setDraftNotes(item.notes); }

  async function saveReview() {
    if (!selected || !isAdmin) return;
    const updated: CatalogImage = { ...selected, status: draftStatus, notes: draftNotes.trim(), updatedAt: 'Ahora', isNew: false };
    try { if (isBackendConfigured) await saveCatalogReview(updated); setImages((current) => current.map((item) => item.id === selected.id ? updated : item)); setSelected(null); showNotice('Observación guardada para todos los usuarios.'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'No se pudo guardar la observación.', true); }
  }

  async function markVisibleCorrect() {
    if (!isAdmin) return;
    const visibleIds = new Set(filtered.map((item) => item.id));
    const updated = images.map((item) => visibleIds.has(item.id) ? { ...item, status: 'Sin observaciones' as ReviewStatus, notes: '', updatedAt: 'Ahora', isNew: false } : item);
    try {
      if (isBackendConfigured) await Promise.all(updated.filter((item) => visibleIds.has(item.id)).map(saveCatalogReview));
      setImages(updated); setConfirmAll(false); showNotice(`${visibleIds.size} imágenes marcadas como correctas.`);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'No se pudieron guardar todos los cambios.', true); }
  }

  async function handleZip(file?: File) {
    if (!file || !isAdmin) return;
    if (!file.name.toLowerCase().endsWith('.zip')) { showNotice('Selecciona un archivo ZIP.', true); return; }
    if (!isBackendConfigured) { showNotice('La carga funciona al configurar Supabase; este es el modo de demostración.', true); return; }
    setUploading(true); setUploadProgress({ done: 0, total: 0 });
    try {
      const total = await uploadCatalogZip(file, (done, count) => setUploadProgress({ done, total: count }));
      setImages(await loadCatalog()); showNotice(`${total} imágenes procesadas correctamente.`);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'No se pudo procesar el ZIP.', true); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function exportExcel() {
    const XLSX = await import('xlsx');
    const rows = filtered.map((item) => ({ País: item.country, Código: item.countryCode, Imagen: item.name, Carpeta: item.folder, Estado: item.status, Observaciones: item.notes, Actualización: item.updatedAt }));
    const sheet = XLSX.utils.json_to_sheet(rows); sheet['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 24 }, { wch: 34 }, { wch: 22 }, { wch: 52 }, { wch: 18 }];
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Revisión de imágenes'); XLSX.writeFile(workbook, `revision-imagenes-${new Date().toISOString().slice(0, 10)}.xlsx`); showNotice('Excel descargado con los filtros actuales.');
  }

  if (authLoading && !role) return <LoadingScreen />;
  if (!role) return <LoginScreen email={email} password={password} setEmail={setEmail} setPassword={setPassword} onSubmit={handleLogin} onDemo={enterDemo} />;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="brand-header"><div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-5 py-5 lg:px-8"><div className="flex items-center gap-3"><div className="brand-mark" aria-hidden="true">dn</div><div><p className="text-lg font-semibold leading-none tracking-tight text-white">Revisión IRT</p><p className="mt-1 text-sm text-white/65">Catálogo regional de imágenes</p></div></div><div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-2 text-sm text-white/80 sm:flex"><UserRound className="size-4" /><span className="max-w-48 truncate">{userEmail}</span><Badge className={isAdmin ? 'bg-[#d91471] text-white' : 'bg-[#2dc5c0] text-[#09263f]'}>{isAdmin ? 'Administrador' : 'Visualizador'}</Badge></div><Button variant="ghost" onClick={() => void handleLogout()} className="text-white hover:bg-white/10 hover:text-white"><LogOut className="size-4" /><span className="hidden md:inline">Salir</span></Button></div></div></header>
      <section className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-9">
        <div className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#d91471]"><Sparkles className="size-4" /> Control de calidad regional</div><h1 className="max-w-3xl text-3xl font-semibold tracking-[-0.035em] text-[#102f4f] sm:text-4xl">Encuentra, revisa y documenta cada imagen</h1><p className="mt-2 max-w-2xl text-base text-muted-foreground">Busca por nombre, filtra por país y consulta las observaciones compartidas.</p></div><div className="flex flex-wrap gap-3">{isAdmin && <><input ref={fileInput} type="file" accept=".zip,application/zip" className="sr-only" onChange={(event) => void handleZip(event.target.files?.[0])} /><Button variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()} className="h-11 rounded-xl border-[#9ab1c4] bg-white px-5 text-[#102f4f]"><Upload /> {uploading ? 'Procesando…' : 'Subir ZIP'}</Button></>}<Button onClick={exportExcel} className="h-11 rounded-xl bg-[#d91471] px-5 text-white shadow-[0_10px_25px_rgba(217,20,113,.22)] hover:bg-[#bd0e61]"><Download /> Descargar Excel</Button></div></div>
        {uploading && <div className="upload-progress"><div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-[#102f4f]"><FileArchive className="size-4 text-[#d91471]" /> Cargando catálogo</span><span>{uploadProgress.total ? `${uploadProgress.done} / ${uploadProgress.total}` : 'Leyendo ZIP…'}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#dce7ec]"><div className="h-full rounded-full bg-[#2aa5a2] transition-all" style={{ width: uploadProgress.total ? `${(uploadProgress.done / uploadProgress.total) * 100}%` : '12%' }} /></div></div>}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Imágenes" value={counts.total} color="navy" /><Metric label="Sin observaciones" value={counts.correct} color="green" /><Metric label="Sin revisar" value={counts.pending} color="amber" /><Metric label="Con hallazgos" value={counts.issues} color="pink" /></div>
        <div className="control-panel"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-[#47627a]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, por ejemplo IMG001" aria-label="Buscar imágenes" className="h-12 rounded-xl border-[#d6e0e8] bg-white pl-10 text-base shadow-sm" />{query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Limpiar búsqueda"><X className="size-4" /></button>}</div><FilterSelect label="País" value={country} options={countries} onChange={setCountry} /><FilterSelect label="Observación" value={status} options={['Todas', ...REVIEW_OPTIONS]} onChange={setStatus} />{isAdmin && <Button variant="outline" onClick={() => setConfirmAll(true)} disabled={!filtered.length} className="h-12 rounded-xl border-[#9ab1c4] bg-white px-4 text-[#102f4f]"><CheckCircle2 /> Marcar visibles correctas</Button>}</div>
        <div className="mb-4 mt-7 flex items-center justify-between"><p className="text-sm font-medium text-[#47627a]"><span className="font-semibold text-[#102f4f]">{filtered.length}</span> resultados</p><p className="hidden text-sm text-muted-foreground sm:block">Haz clic en una imagen para abrirla</p></div>
        {filtered.length ? <div className="image-grid">{filtered.map((item, index) => <button key={item.id} onClick={() => openImage(item)} className="image-card group text-left"><div className={`thumb thumb-${(index % 4) + 1}`}>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" /> : <><div className="thumb-code">{item.countryCode}</div><ImageIcon className="size-9 text-white/80" /><span className="text-sm font-medium text-white/75">Vista previa</span></>}<span className="expand-chip"><Expand className="size-4" /> Abrir</span></div><div className="p-4"><div className="mb-3 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-[#102f4f]">{item.name}</p><p className="mt-1 truncate text-sm text-muted-foreground">{item.folder}</p></div><ChevronRight className="mt-0.5 size-5 shrink-0 text-[#8aa0b2]" /></div><div className="flex items-center justify-between gap-2"><span className={`status-pill status-${statusTone(item.status)}`}>{item.status}</span><span className="text-xs text-muted-foreground">{item.updatedAt}</span></div></div></button>)}</div> : <div className="empty-state"><Search className="size-9 text-[#8aa0b2]" /><h2 className="mt-4 text-lg font-semibold text-[#102f4f]">No encontramos imágenes</h2><p className="mt-1 text-sm text-muted-foreground">{images.length ? 'Prueba con otro nombre o cambia los filtros.' : 'El administrador todavía no ha cargado el catálogo ZIP.'}</p></div>}
      </section>
      <footer className="mx-auto flex max-w-[1480px] flex-col gap-2 border-t px-5 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" /> Acceso protegido por usuario y contraseña</span><span>Solo el administrador puede modificar el catálogo</span></footer>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-4xl">{selected && <div className="grid min-h-[520px] md:grid-cols-[1.25fr_.75fr]"><div className="relative flex min-h-[310px] items-center justify-center overflow-hidden bg-[#0d2b49] p-10"><div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,#2dc5c0_0,transparent_36%),radial-gradient(circle_at_80%_75%,#d91471_0,transparent_35%)]" />{selected.imageUrl ? <img src={selected.imageUrl} alt={selected.name} className="relative max-h-[68vh] max-w-full object-contain" /> : <div className="relative flex flex-col items-center text-white/75"><FileImage className="size-20" /><p className="mt-4 text-lg font-medium">{selected.name}</p></div>}</div><div className="flex flex-col p-6"><DialogHeader><div className="mb-1 flex items-center gap-2"><Badge className="bg-[#e8f3f6] text-[#16526b]">{selected.country}</Badge>{selected.isNew && <Badge className="bg-amber-100 text-amber-800">Nueva</Badge>}</div><DialogTitle className="text-xl text-[#102f4f]">{selected.name}</DialogTitle><DialogDescription>{selected.folder}</DialogDescription></DialogHeader><div className="mt-7 flex-1 space-y-6"><label className="block"><span className="mb-2 block text-sm font-semibold text-[#29475f]">Resultado de la revisión</span>{isAdmin ? <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as ReviewStatus)}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{REVIEW_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select> : <div className={`status-pill status-${statusTone(selected.status)}`}>{selected.status}</div>}</label><label className="block"><span className="mb-2 block text-sm font-semibold text-[#29475f]">Detalle de la observación</span>{isAdmin ? <Textarea value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} placeholder="Describe lo que encontraste en la imagen…" className="min-h-32 resize-none rounded-xl" /> : <div className="min-h-24 rounded-xl border bg-[#f5f8fa] p-3 text-sm text-[#47627a]">{selected.notes || 'Sin detalle adicional.'}</div>}</label></div><DialogFooter className="mt-7 bg-[#f5f8fa]"><Button variant="outline" onClick={() => setSelected(null)}>{isAdmin ? 'Cancelar' : 'Cerrar'}</Button>{isAdmin && <Button onClick={() => void saveReview()} className="bg-[#d91471] text-white hover:bg-[#bd0e61]">Guardar observación</Button>}</DialogFooter></div></div>}</DialogContent></Dialog>
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Marcar {filtered.length} imágenes como correctas?</AlertDialogTitle><AlertDialogDescription>Se cambiarán las imágenes visibles a “Sin observaciones” y se eliminarán sus notas actuales.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void markVisibleCorrect()} className="bg-[#d91471] text-white hover:bg-[#bd0e61]">Sí, marcar correctas</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      {notice && <div role="status" className={`toast-notice ${errorNotice ? 'toast-error' : ''}`}>{errorNotice ? <X className="size-5 text-red-500" /> : <CheckCircle2 className="size-5 text-emerald-500" />}{notice}</div>}
    </main>
  );
}

function LoginScreen({ email, password, setEmail, setPassword, onSubmit, onDemo }: { email: string; password: string; setEmail: (value: string) => void; setPassword: (value: string) => void; onSubmit: (event: React.FormEvent) => void; onDemo: (role: UserRole) => void }) {
  return <main className="login-shell"><section className="login-card"><div className="brand-mark mx-auto" aria-hidden="true">dn</div><p className="mt-5 text-center text-sm font-semibold uppercase tracking-[.18em] text-[#2aa5a2]">Dichter & Neira</p><h1 className="mt-2 text-center text-3xl font-semibold tracking-tight text-[#102f4f]">Revisión IRT</h1><p className="mx-auto mt-2 max-w-sm text-center text-sm text-muted-foreground">Ingresa para consultar el catálogo. Las opciones de carga y edición se habilitan únicamente al administrador.</p>{isBackendConfigured ? <form onSubmit={onSubmit} className="mt-8 space-y-4"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-[#29475f]">Correo</span><Input type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="h-12 rounded-xl" /></label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-[#29475f]">Contraseña</span><Input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-12 rounded-xl" /></label><Button type="submit" className="h-12 w-full rounded-xl bg-[#d91471] text-white hover:bg-[#bd0e61]">Ingresar</Button></form> : <div className="mt-8 rounded-2xl border border-[#cde0e4] bg-[#f3faf9] p-4"><p className="text-sm font-semibold text-[#153b5d]">Vista de demostración</p><p className="mt-1 text-xs text-muted-foreground">Conecta Supabase para activar las cuentas reales y guardar la información.</p><div className="mt-4 grid gap-2 sm:grid-cols-2"><Button onClick={() => onDemo('viewer')} variant="outline" className="h-11 rounded-xl">Ver como visualizador</Button><Button onClick={() => onDemo('admin')} className="h-11 rounded-xl bg-[#153b5d]">Ver como admin</Button></div></div>}</section></main>;
}

function LoadingScreen() { return <main className="login-shell"><div className="flex flex-col items-center text-[#102f4f]"><LoaderCircle className="size-9 animate-spin text-[#2aa5a2]" /><p className="mt-3 text-sm font-semibold">Abriendo el catálogo…</p></div></main>; }
function Metric({ label, value, color }: { label: string; value: number; color: 'navy' | 'green' | 'amber' | 'pink' }) { return <div className={`metric metric-${color}`}><span className="metric-dot" /><div><p className="text-2xl font-semibold tracking-tight text-[#102f4f]">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div></div>; }
function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="flex min-w-44 flex-col gap-1.5"><span className="text-xs font-semibold uppercase tracking-wider text-[#61788b]">{label}</span><Select value={value} onValueChange={(next) => onChange(next as string)}><SelectTrigger className="h-12 w-full rounded-xl border-[#d6e0e8] bg-white px-3 shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></label>; }
