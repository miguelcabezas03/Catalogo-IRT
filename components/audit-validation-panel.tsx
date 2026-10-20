"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  ClipboardList,
  FileImage,
  Images,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type AuditImage,
  type AuditSession,
  loadAuditImages,
  loadAuditSession,
  loadAuditSessions,
} from "@/lib/catalog";

function labelForField(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function normalizeFieldName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function auditValue(data: Record<string, unknown>, candidates: string[]) {
  const candidateSet = new Set(candidates.map(normalizeFieldName));
  const entry = Object.entries(data).find(([key]) => candidateSet.has(normalizeFieldName(key)));
  if (!entry || entry[1] === null || entry[1] === undefined || entry[1] === "") return "";
  return displayValue(entry[1]).trim();
}

function auditCountry(session: AuditSession) {
  return auditValue(session.data, ["PAIS", "COUNTRY"]);
}

function auditStatus(session: AuditSession) {
  return auditValue(session.data, ["ESTADO", "ESTATUS", "STATUS", "SUBSTATUS"]);
}

function auditDate(session: AuditSession) {
  const value = auditValue(session.data, ["Fecha_del_audito"]);
  if (!value) return "";

  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;

  const dayFirstDate = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dayFirstDate) {
    return `${dayFirstDate[3]}-${dayFirstDate[2].padStart(2, "0")}-${dayFirstDate[1].padStart(2, "0")}`;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) return "";
  return [
    parsedDate.getUTCFullYear(),
    String(parsedDate.getUTCMonth() + 1).padStart(2, "0"),
    String(parsedDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function formatAuditDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function AuditValidationPanel() {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<AuditSession | null>(null);
  const [images, setImages] = useState<AuditImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<AuditImage | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("Todos");
  const [status, setStatus] = useState("Todos");
  const [auditDateFilter, setAuditDateFilter] = useState("");
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingImages, setLoadingImages] = useState(false);
  const [error, setError] = useState("");

  const countries = useMemo(
    () => [
      "Todos",
      ...Array.from(new Set(sessions.map(auditCountry).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    ],
    [sessions],
  );

  const statuses = useMemo(
    () => [
      "Todos",
      ...Array.from(new Set(sessions.map(auditStatus).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "es"),
      ),
    ],
    [sessions],
  );

  const filteredSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sessions.filter((session) => {
      const matchesSearch = !term || session.auditId.toLowerCase().includes(term);
      const matchesCountry = country === "Todos" || auditCountry(session) === country;
      const matchesStatus = status === "Todos" || auditStatus(session) === status;
      const matchesDate = !auditDateFilter || auditDate(session) === auditDateFilter;
      return matchesSearch && matchesCountry && matchesStatus && matchesDate;
    });
  }, [auditDateFilter, country, search, sessions, status]);

  const auditFields = useMemo(() => {
    if (!selectedSession) return [];
    return Object.entries(selectedSession.data)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .sort(([left], [right]) => {
        if (left === "ID_de_audito") return -1;
        if (right === "ID_de_audito") return 1;
        return left.localeCompare(right, "es");
      });
  }, [selectedSession]);

  async function refreshSessions() {
    setLoadingSessions(true);
    setError("");
    try {
      const rows = await loadAuditSessions();
      setSessions(rows);
      if (selectedSession) {
        setSelectedSession(rows.find((row) => row.auditId === selectedSession.auditId) ?? null);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "No se pudieron cargar las auditorías.",
      );
    } finally {
      setLoadingSessions(false);
    }
  }

  async function openAudit(session: AuditSession) {
    setSelectedSession(session);
    setSelectedImage(null);
    setImages([]);
    setLoadingImages(true);
    setError("");
    try {
      const [details, auditImages] = await Promise.all([
        loadAuditSession(session.auditId),
        loadAuditImages(session.auditId),
      ]);
      setSelectedSession(details);
      setImages(auditImages);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudieron cargar las imágenes de la auditoría.",
      );
    } finally {
      setLoadingImages(false);
    }
  }

  useEffect(() => {
    void refreshSessions();
  }, []);

  return (
    <section className="validation-pane audit-pane" aria-label="Validación de auditorías">
      <div className="audit-pane-header">
        <div>
          <p className="audit-eyebrow">
            <ClipboardList className="size-4" /> Validación de campo
          </p>
          <h2>Auditorías e imágenes</h2>
          <p>Selecciona un código para consultar sus evidencias y abrir la información completa.</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => void refreshSessions()}
          disabled={loadingSessions}
          aria-label="Actualizar auditorías"
          className="shrink-0 bg-white"
        >
          <RefreshCw className={`size-4 ${loadingSessions ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="audit-browser">
        <aside className="audit-code-panel">
          <label className="audit-search">
            <Search className="size-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar código"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Limpiar búsqueda">
                <X className="size-4" />
              </button>
            )}
          </label>
          <div className="audit-filters" aria-label="Filtros de auditorías">
            <label>
              <span>País</span>
              <select value={country} onChange={(event) => setCountry(event.target.value)}>
                {countries.map((value) => (
                  <option key={value} value={value}>
                    {value === "Todos" ? "Todos los países" : value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Estatus</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {statuses.map((value) => (
                  <option key={value} value={value}>
                    {value === "Todos" ? "Todos los estatus" : value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Fecha de auditoría</span>
              <input
                type="date"
                value={auditDateFilter}
                onChange={(event) => setAuditDateFilter(event.target.value)}
                aria-label="Fecha de la auditoría"
                className="h-[2.35rem] w-full rounded-[0.55rem] border border-[#cbd9ea] bg-white px-[0.65rem] text-xs text-[#29475f]"
              />
            </label>
            {(country !== "Todos" || status !== "Todos" || auditDateFilter) && (
              <button
                type="button"
                onClick={() => {
                  setCountry("Todos");
                  setStatus("Todos");
                  setAuditDateFilter("");
                }}
              >
                Limpiar filtros
              </button>
            )}
          </div>
          <div className="audit-code-summary">
            <strong>{filteredSessions.length}</strong> auditorías
          </div>
          <div className="audit-code-list">
            {loadingSessions ? (
              <div className="audit-loading">
                <LoaderCircle className="size-5 animate-spin" /> Cargando códigos…
              </div>
            ) : filteredSessions.length ? (
              filteredSessions.map((session) => (
                <button
                  type="button"
                  key={session.auditId}
                  onClick={() => void openAudit(session)}
                  className={`audit-code-item ${selectedSession?.auditId === session.auditId ? "is-selected" : ""}`}
                >
                  <span>
                    <strong>{session.auditId}</strong>
                    <small>
                      {session.imageCount} {session.imageCount === 1 ? "imagen" : "imágenes"}
                    </small>
                    {(auditCountry(session) || auditStatus(session) || auditDate(session)) && (
                      <small>
                        {[
                          auditCountry(session),
                          auditStatus(session),
                          formatAuditDate(auditDate(session)),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    )}
                  </span>
                  <ChevronRight className="size-4" />
                </button>
              ))
            ) : (
              <div className="audit-empty-small">
                {sessions.length ? "No hay coincidencias." : "Aún no hay auditorías sincronizadas."}
              </div>
            )}
          </div>
        </aside>

        <div className="audit-evidence-panel">
          {error && <div className="audit-error">{error}</div>}
          {!selectedSession ? (
            <div className="audit-placeholder">
              <Images className="size-10" />
              <h3>Elige una auditoría</h3>
              <p>Aquí aparecerán las imágenes asociadas mediante el código de auditoría.</p>
            </div>
          ) : (
            <>
              <div className="audit-selection-heading">
                <div>
                  <span>Código seleccionado</span>
                  <h3>{selectedSession.auditId}</h3>
                </div>
                <span>{selectedSession.imageCount} evidencias</span>
              </div>
              {loadingImages ? (
                <div className="audit-placeholder">
                  <LoaderCircle className="size-8 animate-spin" />
                  <p>Cargando imágenes…</p>
                </div>
              ) : images.length ? (
                <div className="audit-image-grid">
                  {images.map((image, index) => (
                    <button
                      type="button"
                      key={image.imageKey}
                      onClick={() => {
                        setSelectedImage(image);
                        setImageZoom(1);
                      }}
                      className="audit-image-card"
                    >
                      <img
                        src={image.imageUrl}
                        alt={`Evidencia ${index + 1} de la auditoría ${image.auditId}`}
                        loading="lazy"
                      />
                      <span>
                        <FileImage className="size-4" /> Evidencia {index + 1}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="audit-placeholder">
                  <FileImage className="size-9" />
                  <p>Este código no tiene imágenes disponibles.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedImage && selectedSession && (
        <div
          className="audit-inline-detail"
          role="dialog"
          aria-label={`Evidencia de la auditoría ${selectedSession.auditId}`}
        >
          <div className="pane-detail-toolbar">
            <div>
              <span>Evidencia seleccionada</span>
              <strong>Auditoría {selectedSession.auditId}</strong>
            </div>
            <div className="pane-detail-actions">
              <div className="audit-zoom-controls" aria-label="Zoom de la imagen">
                <button
                  type="button"
                  onClick={() => setImageZoom((value) => Math.max(1, value - 0.25))}
                  disabled={imageZoom <= 1}
                  aria-label="Alejar imagen"
                >
                  <ZoomOut className="size-4" />
                </button>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="0.25"
                  value={imageZoom}
                  onChange={(event) => setImageZoom(Number(event.target.value))}
                  aria-label="Nivel de zoom"
                />
                <button
                  type="button"
                  onClick={() => setImageZoom((value) => Math.min(5, value + 0.25))}
                  disabled={imageZoom >= 5}
                  aria-label="Acercar imagen"
                >
                  <ZoomIn className="size-4" />
                </button>
                <button
                  type="button"
                  className="audit-zoom-value"
                  onClick={() => setImageZoom(1)}
                  aria-label="Restablecer zoom al 100 por ciento"
                  title="Restablecer zoom"
                >
                  {Math.round(imageZoom * 100)}%
                </button>
              </div>
              <button
                type="button"
                onClick={() => setSelectedImage(null)}
                aria-label="Cerrar evidencia"
              >
                <X className="size-5" />
              </button>
            </div>
          </div>
          <div className="audit-detail-layout">
            <div className="audit-detail-image audit-zoom-viewer">
              <div
                className="audit-zoom-canvas"
                style={{ width: `${imageZoom * 100}%`, height: `${imageZoom * 100}%` }}
              >
                <img
                  src={selectedImage.imageUrl}
                  alt={`Evidencia de la auditoría ${selectedImage.auditId}`}
                />
              </div>
            </div>
            <div className="audit-detail-data">
              <p>Información asociada a la evidencia seleccionada.</p>
              <dl>
                {auditFields.map(([field, value]) => (
                  <div key={field}>
                    <dt>{labelForField(field)}</dt>
                    <dd>{displayValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
