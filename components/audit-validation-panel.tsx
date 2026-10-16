'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, ClipboardList, FileImage, Images, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { type AuditImage, type AuditSession, loadAuditImages, loadAuditSessions } from '@/lib/catalog';

function labelForField(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function AuditValidationPanel() {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<AuditSession | null>(null);
  const [images, setImages] = useState<AuditImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<AuditImage | null>(null);
  const [search, setSearch] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingImages, setLoadingImages] = useState(false);
  const [error, setError] = useState('');

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return sessions;
    return sessions.filter((session) => session.auditId.toLowerCase().includes(term));
  }, [search, sessions]);

  const auditFields = useMemo(() => {
    if (!selectedSession) return [];
    return Object.entries(selectedSession.data)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .sort(([left], [right]) => {
        if (left === 'ID_de_audito') return -1;
        if (right === 'ID_de_audito') return 1;
        return left.localeCompare(right, 'es');
      });
  }, [selectedSession]);

  async function refreshSessions() {
    setLoadingSessions(true);
    setError('');
    try {
      const rows = await loadAuditSessions();
      setSessions(rows);
      if (selectedSession) {
        setSelectedSession(rows.find((row) => row.auditId === selectedSession.auditId) ?? null);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las auditorías.');
    } finally {
      setLoadingSessions(false);
    }
  }

  async function openAudit(session: AuditSession) {
    setSelectedSession(session);
    setImages([]);
    setLoadingImages(true);
    setError('');
    try {
      setImages(await loadAuditImages(session.auditId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'No se pudieron cargar las imágenes de la auditoría.');
    } finally {
      setLoadingImages(false);
    }
  }

  useEffect(() => { void refreshSessions(); }, []);

  return (
    <section className="validation-pane audit-pane" aria-label="Validación de auditorías">
      <div className="audit-pane-header">
        <div>
          <p className="audit-eyebrow"><ClipboardList className="size-4" /> Validación de campo</p>
          <h2>Auditorías e imágenes</h2>
          <p>Selecciona un código para consultar sus evidencias y abrir la información completa.</p>
        </div>
        <Button variant="outline" size="icon" onClick={() => void refreshSessions()} disabled={loadingSessions} aria-label="Actualizar auditorías" className="shrink-0 bg-white">
          <RefreshCw className={`size-4 ${loadingSessions ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="audit-browser">
        <aside className="audit-code-panel">
          <label className="audit-search">
            <Search className="size-4" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar código" />
            {search && <button type="button" onClick={() => setSearch('')} aria-label="Limpiar búsqueda"><X className="size-4" /></button>}
          </label>
          <div className="audit-code-summary"><strong>{filteredSessions.length}</strong> auditorías</div>
          <div className="audit-code-list">
            {loadingSessions ? <div className="audit-loading"><LoaderCircle className="size-5 animate-spin" /> Cargando códigos…</div>
              : filteredSessions.length ? filteredSessions.map((session) => (
                <button type="button" key={session.auditId} onClick={() => void openAudit(session)} className={`audit-code-item ${selectedSession?.auditId === session.auditId ? 'is-selected' : ''}`}>
                  <span><strong>{session.auditId}</strong><small>{session.imageCount} {session.imageCount === 1 ? 'imagen' : 'imágenes'}</small></span>
                  <ChevronRight className="size-4" />
                </button>
              )) : <div className="audit-empty-small">{sessions.length ? 'No hay coincidencias.' : 'Aún no hay auditorías sincronizadas.'}</div>}
          </div>
        </aside>

        <div className="audit-evidence-panel">
          {error && <div className="audit-error">{error}</div>}
          {!selectedSession ? <div className="audit-placeholder"><Images className="size-10" /><h3>Elige una auditoría</h3><p>Aquí aparecerán las imágenes asociadas mediante el código de auditoría.</p></div>
            : <>
              <div className="audit-selection-heading"><div><span>Código seleccionado</span><h3>{selectedSession.auditId}</h3></div><span>{selectedSession.imageCount} evidencias</span></div>
              {loadingImages ? <div className="audit-placeholder"><LoaderCircle className="size-8 animate-spin" /><p>Cargando imágenes…</p></div>
                : images.length ? <div className="audit-image-grid">{images.map((image, index) => (
                  <button type="button" key={image.imageKey} onClick={() => setSelectedImage(image)} className="audit-image-card">
                    <img src={image.imageUrl} alt={`Evidencia ${index + 1} de la auditoría ${image.auditId}`} loading="lazy" />
                    <span><FileImage className="size-4" /> Evidencia {index + 1}</span>
                  </button>
                ))}</div> : <div className="audit-placeholder"><FileImage className="size-9" /><p>Este código no tiene imágenes disponibles.</p></div>}
            </>}
        </div>
      </div>

      <Dialog open={Boolean(selectedImage)} onOpenChange={(open) => !open && setSelectedImage(null)}>
        <DialogContent className="max-h-[96dvh] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden p-0 sm:max-w-6xl">
          {selectedImage && selectedSession && <div className="audit-detail-layout">
            <div className="audit-detail-image"><img src={selectedImage.imageUrl} alt={`Evidencia de la auditoría ${selectedImage.auditId}`} /></div>
            <div className="audit-detail-data">
              <DialogHeader><DialogTitle>Auditoría {selectedSession.auditId}</DialogTitle><DialogDescription>Información asociada a la evidencia seleccionada.</DialogDescription></DialogHeader>
              <dl>{auditFields.map(([field, value]) => <div key={field}><dt>{labelForField(field)}</dt><dd>{displayValue(value)}</dd></div>)}</dl>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </section>
  );
}
