'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, ChevronRight, Download, Expand, FileImage, FolderOpen, LoaderCircle, LogOut, Search, ShieldCheck, Sparkles, Upload, UserRound, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { type CatalogImage, type ReviewStatus, type UserRole, getCurrentUser, hydrateImageUrls, isBackendConfigured, loadCatalog, NO_STUDY, saveReview as saveCatalogReview, signIn, signOut, supabase, uploadCatalogFiles } from '@/lib/catalog';

const REVIEW_OPTIONS: ReviewStatus[] = ['Sin observaciones', 'Sin revisar', 'Borrosa', 'Mala calidad', 'Imagen incorrecta', 'Incompleta', 'Duplicada', 'Otra'];
function statusTone(status: ReviewStatus) {
  if (status === 'Sin observaciones') return 'good';
  if (status === 'Sin revisar') return 'pending';
  return 'issue';
}

export default function Home() {
  const [images, setImages] = useState<CatalogImage[]>([]);
  const [role, setRole] = useState<UserRole | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(isBackendConfigured);
  const [userEmail, setUserEmail] = useState('');
  const [codeQuery, setCodeQuery] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [country, setCountry] = useState('Todos');
  const [study, setStudy] = useState('Todos');
  const [brand, setBrand] = useState('Todas');
  const [status, setStatus] = useState('Todas');
  const [selected, setSelected] = useState<CatalogImage | null>(null);
  const [draftStatus, setDraftStatus] = useState<ReviewStatus>('Sin observaciones');
  const [draftNotes, setDraftNotes] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [notice, setNotice] = useState('');
  const [errorNotice, setErrorNotice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [visibleLimit, setVisibleLimit] = useState(60);
  const fileInput = useRef<HTMLInputElement>(null);
  const openedLinkId = useRef<string | null>(null);
  const isAdmin = role === 'admin';

  useEffect(() => {
    if (!isBackendConfigured) { setAuthLoading(false); return; }
    let active = true;
    async function restoreSession() {
      try {
        const current = await getCurrentUser();
        if (active && current) {
          setRole(current.role); setUserEmail(current.user.email?.split('@')[0] ?? 'Usuario');
          setImages(await loadCatalog());
        }
      } catch (error) { if (active) showNotice(error instanceof Error ? error.message : 'No se pudo abrir la sesión.', true); }
      finally { if (active) setAuthLoading(false); }
    }
    void restoreSession();
    const listener = supabase?.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') { setRole(null); setImages([]); } });
    return () => { active = false; listener?.data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!client || !role) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const refreshCatalog = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { void loadCatalog().then(setImages); }, 500);
    };
    const channel = client
      .channel('catalogo-compartido')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'catalog_images' }, refreshCatalog)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'imagen_estudios' }, refreshCatalog)
      .subscribe();
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void client.removeChannel(channel);
    };
  }, [role]);

  const countries = useMemo(() => ['Todos', ...Array.from(new Set(images.map((item) => item.country)))], [images]);
  const studies = useMemo(() => {
    const identified = Array.from(new Set(images.flatMap((item) => item.studies))).sort();
    return ['Todos', ...identified, ...(images.some((item) => !item.studies.length) ? [NO_STUDY] : [])];
  }, [images]);
  const brands = useMemo(() => ['Todas', ...Array.from(new Set(images.flatMap((item) => item.brands))).sort()], [images]);
  const filtered = useMemo(() => {
    const normalizedCode = codeQuery.trim().toLowerCase();
    const normalizedName = nameQuery.trim().toLowerCase();
    return images.filter((item) => {
      const matchesCode = !normalizedCode || item.imageCode.toLowerCase().includes(normalizedCode);
      const matchesName = !normalizedName || item.name.toLowerCase().includes(normalizedName) || item.masterNames.some((value) => value.toLowerCase().includes(normalizedName));
      const matchesCountry = country === 'Todos' || item.country === country;
      const matchesStudy = study === 'Todos' || (study === NO_STUDY ? !item.studies.length : item.studies.includes(study));
      const matchesBrand = brand === 'Todas' || item.brands.includes(brand);
      const matchesStatus = status === 'Todas' || item.status === status;
      return matchesCode && matchesName && matchesCountry && matchesStudy && matchesBrand && matchesStatus;
    });
  }, [brand, codeQuery, country, images, nameQuery, status, study]);
  const visibleImages = useMemo(() => filtered.slice(0, visibleLimit), [filtered, visibleLimit]);
  const counts = useMemo(() => ({ total: images.length, correct: images.filter((item) => item.status === 'Sin observaciones').length, pending: images.filter((item) => item.status === 'Sin revisar').length, issues: images.filter((item) => !['Sin observaciones', 'Sin revisar'].includes(item.status)).length }), [images]);

  useEffect(() => {
    if (!images.length) return;
    const imageId = new URLSearchParams(window.location.search).get('imagen');
    if (!imageId || openedLinkId.current === imageId) return;
    const match = images.find((item) => item.id === imageId);
    if (match) { openedLinkId.current = imageId; openImage(match); }
  }, [images]);

  useEffect(() => { setVisibleLimit(60); }, [brand, codeQuery, country, nameQuery, status, study]);

  useEffect(() => {
    const missing = visibleImages.filter((item) => !item.imageUrl);
    if (!missing.length) return;
    let active = true;
    void hydrateImageUrls(missing).then((hydrated) => {
      if (!active) return;
      const urls = new Map(hydrated.filter((item) => item.imageUrl).map((item) => [item.id, item.imageUrl]));
      if (!urls.size) return;
      setImages((current) => current.map((item) => urls.has(item.id) ? { ...item, imageUrl: urls.get(item.id) } : item));
    }).catch((error) => showNotice(error instanceof Error ? error.message : 'No se pudieron cargar las vistas previas.', true));
    return () => { active = false; };
  }, [visibleImages]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: () => unknown }, options?: { signal?: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({ name: 'get_catalog_summary', title: 'Consultar resumen del catálogo', description: 'Devuelve el total de imágenes y sus estados actuales sin modificar datos.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute: () => ({ ...counts, visible: filtered.length, countryFilter: country, studyFilter: study, brandFilter: brand, codeFilter: codeQuery, nameFilter: nameQuery, observationFilter: status }) }, { signal: lifecycle.signal })).catch(() => undefined);
    return () => lifecycle.abort();
  }, [brand, codeQuery, counts, country, filtered.length, nameQuery, status, study]);

  function showNotice(message: string, error = false) {
    setNotice(message); setErrorNotice(error);
    window.setTimeout(() => setNotice(''), 3600);
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault(); setAuthLoading(true);
    try {
      await signIn(username, password);
      const current = await getCurrentUser();
      if (!current) throw new Error('No encontramos el perfil de este usuario.');
      setRole(current.role); setUserEmail(username.trim()); setImages(await loadCatalog()); setPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      showNotice(message.toLowerCase().includes('invalid login credentials') ? 'Usuario o contraseña incorrectos. Usa “visualizador” o “admin” sin espacios.' : (message || 'No fue posible iniciar sesión.'), true);
    }
    finally { setAuthLoading(false); }
  }

  async function handleLogout() { await signOut(); setRole(null); setImages([]); setUserEmail(''); }
  function openImage(item: CatalogImage) { setSelected(item); setDraftStatus(item.status); setDraftNotes(item.notes); }

  async function saveReview() {
    if (!selected) return;
    const updated: CatalogImage = { ...selected, status: draftStatus, notes: draftNotes.trim(), updatedAt: 'Ahora', isNew: false };
    try { if (isBackendConfigured) await saveCatalogReview(updated); setImages((current) => current.map((item) => item.id === selected.id ? updated : item)); setSelected(null); showNotice('Observación guardada para todos los usuarios.'); }
    catch (error) { showNotice(error instanceof Error ? error.message : 'No se pudo guardar la observación.', true); }
  }

  async function markVisibleCorrect() {
    const visibleIds = new Set(filtered.map((item) => item.id));
    const updated = images.map((item) => visibleIds.has(item.id) ? { ...item, status: 'Sin observaciones' as ReviewStatus, notes: '', updatedAt: 'Ahora', isNew: false } : item);
    try {
      if (isBackendConfigured) await Promise.all(updated.filter((item) => visibleIds.has(item.id)).map(saveCatalogReview));
      setImages(updated); setConfirmAll(false); showNotice(`${visibleIds.size} imágenes marcadas como correctas.`);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'No se pudieron guardar todos los cambios.', true); }
  }

  async function handleFolder(fileList?: FileList | null) {
    if (!fileList?.length || !isAdmin) return;
    if (!isBackendConfigured) { showNotice('La sincronización funciona al configurar Supabase; este es el modo de demostración.', true); return; }
    setUploading(true); setUploadProgress({ done: 0, total: 0 });
    try {
      const result = await uploadCatalogFiles(Array.from(fileList), (done, count) => setUploadProgress({ done, total: count }));
      setImages(await loadCatalog());
      if (result.failed) showNotice(`${result.processed} imágenes guardadas y ${result.failed} no pudieron cargarse. ${result.firstError ?? ''}`, true);
      else showNotice(`${result.processed} imágenes procesadas correctamente.`);
    } catch (error) { showNotice(error instanceof Error ? error.message : 'No se pudo sincronizar la carpeta.', true); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const [XLSX, imagesWithLinks] = await Promise.all([
        import('xlsx'),
        hydrateImageUrls(filtered, 30 * 24 * 60 * 60),
      ]);
      const rows = imagesWithLinks.map((item) => ({ País: item.country, 'Código IRT': item.imageCode, Imagen: item.name, Nombre: item.masterNames.join(' | '), Carpeta: item.folder, Estudio: item.studies.join(' | ') || NO_STUDY, Marca: item.brands.join(' | '), Estado: item.status, Observaciones: item.notes, Actualización: item.updatedAt, 'Ver imagen': item.imageUrl ?? '' }));
      const sheet = XLSX.utils.json_to_sheet(rows);
      rows.forEach((row, index) => { const cell = sheet[`K${index + 2}`]; if (cell && row['Ver imagen']) cell.l = { Target: row['Ver imagen'], Tooltip: 'Abrir la imagen directamente' }; });
      sheet['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 24 }, { wch: 34 }, { wch: 34 }, { wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 52 }, { wch: 18 }, { wch: 70 }];
      const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Revisión de imágenes'); XLSX.writeFile(workbook, `revision-imagenes-${new Date().toISOString().slice(0, 10)}.xlsx`);
      showNotice('Excel descargado con enlaces directos válidos durante 30 días.');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'No se pudo preparar el Excel.', true);
    } finally {
      setExporting(false);
    }
  }

  if (authLoading && !role) return <LoadingScreen />;
  if (!role) return <LoginScreen username={username} password={password} setUsername={setUsername} setPassword={setPassword} onSubmit={handleLogin} />;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="brand-header"><div className="brand-header-inner mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-5 py-5 lg:px-8"><div className="flex min-w-0 items-center gap-3"><div className="brand-mark shrink-0" aria-hidden="true">dn</div><div className="min-w-0"><p className="truncate text-base font-semibold leading-none tracking-tight text-white sm:text-lg">Revisión IRT</p><p className="brand-subtitle mt-1 truncate text-sm text-white/65">Catálogo regional de imágenes</p></div></div><div className="flex shrink-0 items-center gap-2"><div className="hidden items-center gap-2 rounded-full border border-white/15 bg-white/8 px-3 py-2 text-sm text-white/80 sm:flex"><UserRound className="size-4" /><span className="max-w-32 truncate lg:max-w-48">{userEmail}</span><Badge className={isAdmin ? 'bg-[#d91471] text-white' : 'bg-[#2dc5c0] text-[#09263f]'}>{isAdmin ? 'Administrador' : 'Visualizador'}</Badge></div><Button variant="ghost" onClick={() => void handleLogout()} aria-label="Cerrar sesión" className="logout-button border border-white/20 px-3 text-white hover:bg-white/10 hover:text-white sm:px-4"><LogOut className="size-4 shrink-0" /><span className="logout-label">Cerrar sesión</span></Button></div></div></header>
      <section className="page-shell mx-auto w-full max-w-[1480px] px-5 py-7 lg:px-8 lg:py-9">
        <div className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#d91471]"><Sparkles className="size-4 shrink-0" /> Control de calidad regional</div><h1 className="max-w-3xl text-2xl font-semibold tracking-[-0.035em] text-[#102f4f] sm:text-4xl">Encuentra, revisa y documenta cada imagen</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">Busca por nombre, filtra por país, estudio, marca y observación, y guarda cambios compartidos.</p></div><div className="hero-actions flex flex-wrap gap-3">{isAdmin && <><input ref={fileInput} type="file" multiple accept="image/*" className="sr-only" {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(event) => void handleFolder(event.target.files)} /><Button variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()} className="h-11 rounded-xl border-[#9ab1c4] bg-white px-5 text-[#102f4f]"><FolderOpen /> {uploading ? 'Sincronizando…' : 'Seleccionar carpeta'}</Button></>}<Button onClick={() => void exportExcel()} disabled={exporting || !filtered.length} className="h-11 rounded-xl bg-[#d91471] px-5 text-white shadow-[0_10px_25px_rgba(217,20,113,.22)] hover:bg-[#bd0e61]"><Download /> {exporting ? 'Preparando enlaces…' : 'Descargar Excel'}</Button></div></div>
        {uploading && <div className="upload-progress"><div className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 font-semibold text-[#102f4f]"><Upload className="size-4 text-[#d91471]" /> Sincronizando carpeta</span><span>{uploadProgress.total ? `${uploadProgress.done} / ${uploadProgress.total}` : 'Leyendo imágenes…'}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#dce7ec]"><div className="h-full rounded-full bg-[#2aa5a2] transition-all" style={{ width: uploadProgress.total ? `${(uploadProgress.done / uploadProgress.total) * 100}%` : '12%' }} /></div></div>}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Imágenes" value={counts.total} color="navy" /><Metric label="Sin observaciones" value={counts.correct} color="green" /><Metric label="Sin revisar" value={counts.pending} color="amber" /><Metric label="Con hallazgos" value={counts.issues} color="pink" /></div>
        <div className="control-panel"><SearchField label="Código" value={codeQuery} placeholder="Ej. ES29000017" onChange={setCodeQuery} /><SearchField label="Nombre" value={nameQuery} placeholder="Nombre del maestro o archivo" onChange={setNameQuery} /><FilterSelect label="País" value={country} options={countries} onChange={setCountry} /><FilterSelect label="Estudio" value={study} options={studies} onChange={setStudy} /><FilterSelect label="Marca" value={brand} options={brands} onChange={setBrand} /><FilterSelect label="Observación" value={status} options={['Todas', ...REVIEW_OPTIONS]} onChange={setStatus} /><Button variant="outline" onClick={() => setConfirmAll(true)} disabled={!filtered.length} className="h-12 rounded-xl border-[#9ab1c4] bg-white px-4 text-[#102f4f]"><CheckCircle2 /> Marcar visibles correctas</Button></div>
        <div className="mb-4 mt-7 flex items-center justify-between"><p className="text-sm font-medium text-[#47627a]"><span className="font-semibold text-[#102f4f]">{filtered.length}</span> resultados</p><p className="hidden text-sm text-muted-foreground sm:block">Haz clic en una imagen para abrirla</p></div>
        {filtered.length ? <><div className="image-grid">{visibleImages.map((item, index) => <button key={item.id} onClick={() => openImage(item)} className="image-card group text-left"><div className={`thumb thumb-${(index % 4) + 1}`}>{item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" className="relative z-[1] h-full w-full bg-white object-contain p-3" /> : <><div className="thumb-code">{item.countryCode}</div><LoaderCircle className="size-8 animate-spin text-white/80" /><span className="text-sm font-medium text-white/75">Cargando vista…</span></>}<span className="expand-chip"><Expand className="size-4" /> Abrir</span></div><div className="p-4"><div className="mb-3 flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-[#102f4f]">{item.name}</p><p className="mt-1 truncate text-sm text-muted-foreground">Código: {item.imageCode}</p>{item.masterNames.length > 0 && <p className="mt-1 truncate text-sm text-muted-foreground">Nombre: {item.masterNames.join(' · ')}</p>}<p className="mt-1 truncate text-xs font-medium text-[#2a7775]">{item.studies.join(' · ') || NO_STUDY}</p>{item.brands.length > 0 && <p className="mt-1 truncate text-xs text-[#6a5262]">Marca: {item.brands.join(' · ')}</p>}</div><ChevronRight className="mt-0.5 size-5 shrink-0 text-[#8aa0b2]" /></div><div className="flex items-center justify-between gap-2"><span className={`status-pill status-${statusTone(item.status)}`}>{item.status}</span><span className="text-xs text-muted-foreground">{item.updatedAt}</span></div></div></button>)}</div>{visibleImages.length < filtered.length && <div className="mt-8 flex justify-center"><Button variant="outline" onClick={() => setVisibleLimit((current) => current + 60)} className="h-11 rounded-xl border-[#9ab1c4] bg-white px-6 text-[#102f4f]">Mostrar 60 más</Button></div>}</> : <div className="empty-state"><Search className="size-9 text-[#8aa0b2]" /><h2 className="mt-4 text-lg font-semibold text-[#102f4f]">No encontramos imágenes</h2><p className="mt-1 text-sm text-muted-foreground">{images.length ? 'Prueba con otro nombre o cambia los filtros.' : 'El administrador todavía no ha sincronizado una carpeta.'}</p></div>}
      </section>
      <footer className="mx-auto flex max-w-[1480px] flex-col gap-2 border-t px-5 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between lg:px-8"><span className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-600" /> Acceso protegido por usuario y contraseña</span><span>Todos pueden revisar; solo el administrador sincroniza imágenes</span></footer>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[96dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto p-0 sm:w-full sm:max-w-4xl">
          {selected && <div className="grid md:min-h-[520px] md:grid-cols-[1.25fr_.75fr]">
            <div className="relative flex min-h-[230px] items-center justify-center overflow-hidden bg-[#0d2b49] p-4 sm:min-h-[310px] sm:p-10">
              <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,#2dc5c0_0,transparent_36%),radial-gradient(circle_at_80%_75%,#d91471_0,transparent_35%)]" />
              {selected.imageUrl ? <img src={selected.imageUrl} alt={selected.name} className="relative max-h-[42dvh] max-w-full object-contain md:max-h-[68vh]" /> : <div className="relative flex flex-col items-center text-white/75"><FileImage className="size-16 sm:size-20" /><p className="mt-4 break-all text-center text-base font-medium sm:text-lg">{selected.name}</p></div>}
            </div>
            <div className="flex min-w-0 flex-col p-4 sm:p-6">
              <DialogHeader>
                <div className="mb-1 flex flex-wrap items-center gap-2"><Badge className="bg-[#e8f3f6] text-[#16526b]">{selected.country}</Badge>{(selected.studies.length ? selected.studies : [NO_STUDY]).map((value) => <Badge key={`study-${value}`} className="bg-[#e7f5f5] text-[#176b68]">{value}</Badge>)}{selected.brands.map((value) => <Badge key={`brand-${value}`} className="bg-[#f7e8f0] text-[#8b2454]">{value}</Badge>)}{selected.isNew && <Badge className="bg-amber-100 text-amber-800">Nueva</Badge>}</div>
                <DialogTitle className="break-all text-lg text-[#102f4f] sm:text-xl">{selected.name}</DialogTitle>
                <DialogDescription className="space-y-1 break-words"><span className="block">Código: {selected.imageCode}</span>{selected.masterNames.length > 0 && <span className="block">Nombre: {selected.masterNames.join(' · ')}</span>}<span className="block break-all">{selected.folder}</span></DialogDescription>
              </DialogHeader>
              <div className="mt-7 flex-1 space-y-6">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#29475f]">Resultado de la revisión</span>
                  <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as ReviewStatus)}><SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{REVIEW_OPTIONS.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[#29475f]">Detalle de la observación</span>
                  <Textarea value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} placeholder="Describe lo que encontraste en la imagen…" className="min-h-32 resize-none rounded-xl" />
                </label>
              </div>
              <DialogFooter className="mt-7 grid grid-cols-1 gap-2 bg-[#f5f8fa] sm:flex"><Button variant="outline" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={() => void saveReview()} className="bg-[#d91471] text-white hover:bg-[#bd0e61]">Guardar observación</Button></DialogFooter>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Marcar {filtered.length} imágenes como correctas?</AlertDialogTitle><AlertDialogDescription>Se cambiarán las imágenes visibles a “Sin observaciones” y se eliminarán sus notas actuales.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => void markVisibleCorrect()} className="bg-[#d91471] text-white hover:bg-[#bd0e61]">Sí, marcar correctas</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      {notice && <div role="status" className={`toast-notice ${errorNotice ? 'toast-error' : ''}`}>{errorNotice ? <X className="size-5 text-red-500" /> : <CheckCircle2 className="size-5 text-emerald-500" />}{notice}</div>}
    </main>
  );
}

function LoginScreen({ username, password, setUsername, setPassword, onSubmit }: { username: string; password: string; setUsername: (value: string) => void; setPassword: (value: string) => void; onSubmit: (event: React.FormEvent) => void }) {
  return <main className="login-shell"><section className="login-card"><div className="brand-mark" aria-hidden="true">dn</div><div className="mt-8 border-t border-[#dce5ed] pt-8"><p className="text-xs font-bold uppercase tracking-[.18em] text-[#2aa5a2]">Acceso al catálogo IRT</p><h1 className="mt-4 text-4xl font-bold tracking-tight text-[#102f4f]">Bienvenido</h1><p className="mt-4 text-base leading-7 text-muted-foreground">Ingresa con el usuario asignado para consultar y revisar el catálogo compartido.</p></div>{isBackendConfigured ? <form onSubmit={onSubmit} className="mt-8 space-y-5"><label className="block"><span className="mb-2 block text-sm font-semibold text-[#29475f]">Nombre de usuario</span><Input type="text" required autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Admin o Visualizador" className="h-14 rounded-xl border-[#cbd9e7] bg-[#edf4ff] px-5 text-lg" /></label><label className="block"><span className="mb-2 block text-sm font-semibold text-[#29475f]">Contraseña</span><Input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="h-14 rounded-xl border-[#cbd9e7] bg-[#edf4ff] px-5 text-lg" /></label><Button type="submit" className="h-14 w-full rounded-xl bg-[#d91471] text-base font-semibold text-white shadow-lg hover:bg-[#bd0e61]">Ingresar al catálogo <ChevronRight className="ml-2 size-5" /></Button></form> : <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5"><p className="font-semibold text-amber-900">Configuración pendiente</p><p className="mt-1 text-sm leading-6 text-amber-800">La base compartida todavía no está conectada. Por seguridad, el modo de demostración fue desactivado.</p></div>}<p className="mt-8 border-t border-[#dce5ed] pt-6 text-sm text-muted-foreground">¿Necesitas acceso? Contacta al administrador del catálogo.</p></section></main>;
}

function LoadingScreen() { return <main className="login-shell"><div className="flex flex-col items-center text-[#102f4f]"><LoaderCircle className="size-9 animate-spin text-[#2aa5a2]" /><p className="mt-3 text-sm font-semibold">Abriendo el catálogo…</p></div></main>; }
function Metric({ label, value, color }: { label: string; value: number; color: 'navy' | 'green' | 'amber' | 'pink' }) { return <div className={`metric metric-${color}`}><span className="metric-dot" /><div><p className="text-2xl font-semibold tracking-tight text-[#102f4f]">{value}</p><p className="text-sm text-muted-foreground">{label}</p></div></div>; }
function SearchField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) { return <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-semibold uppercase tracking-wider text-[#61788b]">{label}</span><div className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#47627a]" /><Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-12 w-full min-w-0 rounded-xl border-[#d6e0e8] bg-white pl-9 pr-9 shadow-sm" />{value && <button type="button" onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={`Limpiar ${label.toLowerCase()}`}><X className="size-4" /></button>}</div></label>; }
function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) { return <label className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-semibold uppercase tracking-wider text-[#61788b]">{label}</span><Select value={value} onValueChange={(next) => onChange(next as string)}><SelectTrigger className="h-12 w-full min-w-0 rounded-xl border-[#d6e0e8] bg-white px-3 shadow-sm"><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectContent></Select></label>; }
