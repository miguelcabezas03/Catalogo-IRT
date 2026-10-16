# Databricks notebook source
# MAGIC %python

# Sincroniza la nueva vista del usuario VALIDACION.
# Unión: storeview.slv_sv_ceres_ag_export.ID_de_audito
#     = e_sv_kolatam_trad.slv_ru_interview_attach_e_sv_kolatam_trad.RU03_InterviewID

import json
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

images_source = spark.table(IMAGE_TABLE)
audits_source = spark.table(AUDIT_TABLE)

required_image_columns = {"RU03_InterviewID", "RU03_URL"}
required_audit_columns = {"ID_de_audito"}
missing_images = required_image_columns.difference(images_source.columns)
missing_audits = required_audit_columns.difference(audits_source.columns)
if missing_images:
    raise ValueError(f"Faltan columnas en {IMAGE_TABLE}: {sorted(missing_images)}")
if missing_audits:
    raise ValueError(f"Faltan columnas en {AUDIT_TABLE}: {sorted(missing_audits)}")

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

auth_response = requests.post(
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
    batch = []
    completed = 0
    for row in rows:
        batch.append(row_mapper(row))
        if len(batch) < BATCH_SIZE:
            continue
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}",
            headers=headers,
            json=batch,
            timeout=120,
        )
        response.raise_for_status()
        completed += len(batch)
        print(f"{table}: {completed:,} / {total:,}")
        batch = []
    if batch:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict}",
            headers=headers,
            json=batch,
            timeout=120,
        )
        response.raise_for_status()
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

cleanup_headers = {**headers, "Prefer": "return=minimal"}
for table in ["audit_validation_images", "audit_validation_sessions"]:
    cleanup = requests.delete(
        f"{SUPABASE_URL}/rest/v1/{table}?sync_id=neq.{sync_id}",
        headers=cleanup_headers,
        timeout=120,
    )
    cleanup.raise_for_status()

joined.unpersist()
print(f"Sincronización terminada. Código: {sync_id}")
print(f"{session_count:,} auditorías y {image_count:,} imágenes disponibles para VALIDACION.")
