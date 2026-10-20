# Databricks notebook source
# MAGIC %python

# Sincroniza la nueva vista del usuario VALIDACION.
# Unión: storeview.slv_sv_ceres_ag_export.ID_de_audito
#     = e_sv_kolatam_trad.slv_ru_interview_attach_e_sv_kolatam_trad.RU03_InterviewID

import json
import time
import uuid
import requests
from pyspark.sql import functions as F

SUPABASE_URL = dbutils.secrets.get(scope="catalogo-irt", key="supabase-url").rstrip("/")
SUPABASE_KEY = dbutils.secrets.get(scope="catalogo-irt", key="supabase-publishable-key")
SYNC_EMAIL = dbutils.secrets.get(scope="catalogo-irt", key="sync-email")
SYNC_PASSWORD = dbutils.secrets.get(scope="catalogo-irt", key="sync-password")

IMAGE_TABLE = "e_sv_kolatam_trad.slv_ru_interview_attach_e_sv_kolatam_trad"
AUDIT_TABLE = "storeview.slv_sv_ceres_ag_export"
BATCH_SIZE = 500
MAX_REQUEST_RETRIES = 3
MAX_SESSIONS = 100000
MAX_IMAGES = 500000

images_source = spark.table(IMAGE_TABLE)
audits_source = spark.table(AUDIT_TABLE)

required_image_columns = {"RU03_InterviewID", "RU03_URL"}
required_audit_columns = {"ID_de_audito", "Fecha_del_audito"}
missing_images = required_image_columns.difference(images_source.columns)
missing_audits = required_audit_columns.difference(audits_source.columns)
if missing_images:
    raise ValueError(f"Faltan columnas en {IMAGE_TABLE}: {sorted(missing_images)}")
if missing_audits:
    raise ValueError(f"Faltan columnas en {AUDIT_TABLE}: {sorted(missing_audits)}")

# La vista del validador usa únicamente el mes calendario actual: desde el
# primer día (incluido) hasta el primer día del mes siguiente (excluido).
month_start = F.trunc(F.current_date(), "month")
next_month_start = F.add_months(month_start, 1)
audit_date = F.to_date("Fecha_del_audito")
audits_source = audits_source.filter(
    (audit_date >= month_start) & (audit_date < next_month_start)
)

audit_struct = F.struct(*[F.col(column).alias(column) for column in audits_source.columns])
def normalized_id(column):
    return F.regexp_replace(F.trim(column.cast("string")), r"\.0+$", "")

audits = (
    audits_source
    .withColumn("audit_id", normalized_id(F.col("ID_de_audito")))
    .filter(F.col("audit_id").isNotNull() & (F.length("audit_id") > 0))
    .withColumn("audit_json", F.to_json(audit_struct))
    .select("audit_id", "audit_json")
    .dropDuplicates(["audit_id"])
)

images = (
    images_source
    .select(
        normalized_id(F.col("RU03_InterviewID")).alias("audit_id"),
        F.trim(F.col("RU03_URL").cast("string")).alias("image_url"),
    )
    .filter(
        F.col("audit_id").isNotNull()
        & (F.length("audit_id") > 0)
        & F.col("image_url").isNotNull()
        & (F.length("image_url") > 0)
    )
    .dropDuplicates(["audit_id", "image_url"])
    .withColumn("image_key", F.sha2(F.concat_ws("|", "audit_id", "image_url"), 256))
)

# Inner join: solo se publican códigos que existen en ambas fuentes.
joined = images.join(audits, "audit_id", "inner").cache()

sessions_df = (
    joined
    .groupBy("audit_id")
    .agg(
        F.countDistinct("image_key").cast("int").alias("image_count"),
        F.first("audit_json", ignorenulls=True).alias("audit_json"),
    )
    .orderBy("audit_id")
)

images_df = joined.select("image_key", "audit_id", "image_url").dropDuplicates(["image_key"])

session_count = sessions_df.count()
image_count = images_df.count()
print(f"Auditorías preparadas: {session_count:,}")
print(f"Imágenes preparadas: {image_count:,}")
if session_count == 0 or image_count == 0:
    raise ValueError("La unión no devolvió registros. Revisa los tipos y valores de ID_de_audito y RU03_InterviewID.")
if session_count > MAX_SESSIONS or image_count > MAX_IMAGES:
    raise ValueError(
        "La sincronización supera el límite de seguridad "
        f"({session_count:,} auditorías / {image_count:,} imágenes). "
        "Revisa el filtro de Fecha_del_audito antes de continuar."
    )

http = requests.Session()

auth_response = http.post(
    f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
    headers={"apikey": SUPABASE_KEY, "Content-Type": "application/json"},
    json={"email": SYNC_EMAIL, "password": SYNC_PASSWORD},
    timeout=60,
)
auth_response.raise_for_status()
access_token = auth_response.json()["access_token"]
headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}
sync_id = str(uuid.uuid4())

def upsert_iterator(table, rows, conflict, row_mapper, total):
    def send_batch(batch, start_row):
        response = http.post(
            f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}",
            headers=headers,
            json=batch,
            timeout=120,
        )
        if response.ok:
            return

        # PostgREST puede devolver HTTP 500 cuando una transacción de lote
        # resulta demasiado grande para el tiempo disponible. Dividir solo el
        # lote que falló conserva la velocidad normal y evita perder toda la
        # sincronización por un único bloque pesado.
        if response.status_code in {408, 429, 500, 502, 503, 504} and len(batch) > 1:
            middle = len(batch) // 2
            print(
                f"{table}: lote {start_row:,}-{start_row + len(batch) - 1:,} "
                f"respondió HTTP {response.status_code}; reintentando en dos partes"
            )
            send_batch(batch[:middle], start_row)
            send_batch(batch[middle:], start_row + middle)
            return

        # Si el problema llega hasta una sola fila, puede ser transitorio. Se
        # hacen unos pocos reintentos y, si persiste, se informa el cuerpo de
        # la respuesta y la clave exacta para poder diagnosticarlo.
        for attempt in range(1, MAX_REQUEST_RETRIES + 1):
            wait_seconds = 2 ** attempt
            time.sleep(wait_seconds)
            response = http.post(
                f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}",
                headers=headers,
                json=batch,
                timeout=120,
            )
            if response.ok:
                return

        first_row = batch[0] if batch else {}
        row_identifier = first_row.get(conflict, "sin-clave")
        raise RuntimeError(
            f"Upsert en {table} falló para {conflict}={row_identifier} "
            f"(HTTP {response.status_code}): {response.text[:1500]}"
        )

    batch = []
    completed = 0
    for row in rows:
        batch.append(row_mapper(row))
        if len(batch) < BATCH_SIZE:
            continue
        send_batch(batch, completed + 1)
        completed += len(batch)
        print(f"{table}: {completed:,} / {total:,}")
        batch = []
    if batch:
        send_batch(batch, completed + 1)
        completed += len(batch)
        print(f"{table}: {completed:,} / {total:,}")

def session_payload(row):
    return {
        "audit_id": row["audit_id"],
        "image_count": int(row["image_count"]),
        "audit_data": json.loads(row["audit_json"]),
        "sync_id": sync_id,
    }

def image_payload(row):
    return {
        "image_key": row["image_key"],
        "audit_id": row["audit_id"],
        "image_url": row["image_url"],
        "sync_id": sync_id,
    }

upsert_iterator("audit_validation_sessions", sessions_df.toLocalIterator(), "audit_id", session_payload, session_count)
upsert_iterator("audit_validation_images", images_df.toLocalIterator(), "image_key", image_payload, image_count)

# Evitar filtros `sync_id <> actual`: PostgreSQL debe revisar demasiadas filas
# y PostgREST termina cancelando la consulta. Los extremos del índice permiten
# descubrir una versión anterior usando igualdad; después se elimina esa
# versión por claves explícitas y en lotes pequeños.
def checked_json(response, operation):
    if not response.ok:
        raise RuntimeError(
            f"{operation} falló (HTTP {response.status_code}): "
            f"{response.text[:1000]}"
        )
    return response.json()

def find_stale_sync_id(table):
    for direction in ("asc", "desc"):
        response = http.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers=headers,
            params={
                "select": "sync_id",
                "order": f"sync_id.{direction}",
                "limit": "1",
            },
            timeout=120,
        )
        rows = checked_json(response, f"Consulta de versiones en {table}")
        if rows and rows[0]["sync_id"] != sync_id:
            return rows[0]["sync_id"]
    return None

def delete_stale_rows(table, key_column, batch_size):
    deleted_total = 0
    while True:
        stale_sync_id = find_stale_sync_id(table)
        if stale_sync_id is None:
            return deleted_total

        while True:
            pending = http.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers=headers,
                params={
                    "select": key_column,
                    "sync_id": f"eq.{stale_sync_id}",
                    "limit": str(batch_size),
                },
                timeout=120,
            )
            rows = checked_json(pending, f"Consulta de filas anteriores en {table}")
            values = [row[key_column] for row in rows]
            if not values:
                break

            encoded_values = ",".join(json.dumps(value) for value in values)
            deleted = http.delete(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers=headers,
                params={
                    key_column: f"in.({encoded_values})",
                    "sync_id": f"eq.{stale_sync_id}",
                },
                timeout=120,
            )
            if not deleted.ok:
                raise RuntimeError(
                    f"Limpieza de {table} falló (HTTP {deleted.status_code}): "
                    f"{deleted.text[:1000]}"
                )
            deleted_total += len(values)
            print(f"Limpieza {table}: {deleted_total:,} filas anteriores eliminadas")

# Primero se eliminan las imágenes para respetar la relación foránea; luego,
# las sesiones antiguas ya quedan sin hijos y se pueden borrar sin cascadas.
deleted_images_total = delete_stale_rows("audit_validation_images", "image_key", 100)
deleted_sessions_total = delete_stale_rows("audit_validation_sessions", "audit_id", 50)
print(
    "Limpieza anterior terminada: "
    f"{deleted_images_total:,} imágenes y "
    f"{deleted_sessions_total:,} auditorías eliminadas"
)

joined.unpersist()
print(f"Sincronización terminada. Código: {sync_id}")
print(f"{session_count:,} auditorías y {image_count:,} imágenes disponibles para VALIDACION.")
