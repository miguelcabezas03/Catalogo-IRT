%python

# CELDA DE SINCRONIZACIÓN — envía estudio y marca a Supabase.
import requests
import uuid
from datetime import datetime, timezone

SUPABASE_URL = dbutils.secrets.get("catalogo-irt", "supabase-url")
PUBLISHABLE_KEY = dbutils.secrets.get("catalogo-irt", "supabase-publishable-key")
SYNC_EMAIL = dbutils.secrets.get("catalogo-irt", "sync-email")
SYNC_PASSWORD = dbutils.secrets.get("catalogo-irt", "sync-password")
TABLE = "imagen_estudios"
BATCH_SIZE = 500

auth_response = requests.post(
    f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
    headers={"apikey": PUBLISHABLE_KEY, "Content-Type": "application/json"},
    json={"email": SYNC_EMAIL, "password": SYNC_PASSWORD},
    timeout=60,
)
auth_response.raise_for_status()
access_token = auth_response.json()["access_token"]

headers = {
    "apikey": PUBLISHABLE_KEY,
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

sync_id = str(uuid.uuid4())
sync_time = datetime.now(timezone.utc).isoformat()
df = (
    spark.table("maestros_irt_estudios")
    .select("Codigo_Imagen", "Estudio", "Marca", "Pais", "Categoria", "Nombre", "Tabla_Origen")
    .where("Codigo_Imagen IS NOT NULL AND Estudio IS NOT NULL")
    .dropDuplicates(["Codigo_Imagen", "Estudio"])
)


def text_or_none(value):
    return None if value is None else str(value)


rows = []
for row in df.toLocalIterator():
    code = str(row["Codigo_Imagen"]).strip().upper()
    study = str(row["Estudio"]).strip()
    if not code or not study:
        continue
    rows.append({
        "codigo_imagen": code,
        "estudio": study,
        "marca": text_or_none(row["Marca"]),
        "pais": text_or_none(row["Pais"]),
        "categoria": text_or_none(row["Categoria"]),
        "nombre": text_or_none(row["Nombre"]),
        "tabla_origen": text_or_none(row["Tabla_Origen"]),
        "sincronizacion_id": sync_id,
        "fecha_sincronizacion": sync_time,
    })

upsert_url = f"{SUPABASE_URL}/rest/v1/{TABLE}?on_conflict=codigo_imagen,estudio"
print(f"Registros únicos preparados: {len(rows)}")
for start in range(0, len(rows), BATCH_SIZE):
    batch = rows[start:start + BATCH_SIZE]
    response = requests.post(upsert_url, headers=headers, json=batch, timeout=120)
    if response.status_code not in (200, 201, 204):
        raise RuntimeError(
            f"Error en bloque {start // BATCH_SIZE + 1}: "
            f"{response.status_code} - {response.text[:500]}"
        )
    if start == 0 or (start // BATCH_SIZE + 1) % 10 == 0 or start + BATCH_SIZE >= len(rows):
        print(f"Enviados {min(start + BATCH_SIZE, len(rows))} de {len(rows)}")

# Solo después de cargar todo, elimina relaciones que ya no estén en Databricks.
delete_url = f"{SUPABASE_URL}/rest/v1/{TABLE}?sincronizacion_id=neq.{sync_id}"
delete_response = requests.delete(delete_url, headers=headers, timeout=120)
if delete_response.status_code not in (200, 204):
    raise RuntimeError(
        "No se pudieron limpiar registros antiguos: "
        f"{delete_response.status_code} - {delete_response.text[:500]}"
    )

print("Sincronización terminada correctamente")
print(f"Total sincronizado: {len(rows)}")
print(f"ID de sincronización: {sync_id}")
