%python

# CELDA 1 — Diagnóstico y consolidación de maestros IRT.
# El primer resultado explica qué columna usa cada fuente. El segundo resultado
# contiene la tabla completa y se puede descargar desde Download CSV.
# Se incluyen automáticamente las tres OlaID más recientes de cada fuente, que
# corresponden a la ventana móvil de los últimos tres meses del proceso.

import re
import unicodedata
from functools import reduce

from pyspark.sql import functions as F
from pyspark.sql.types import LongType, StringType, StructField, StructType


SOURCES = [
    {
        "estudio": "KO LATAM Regional",
        "tabla": "e_sv_kolatam_mod_regional.brz_ma_sku_irt",
        "pais": "Pais",
        "categoria": "Categoria",
        "nombre": "Nombre",
        "codigo": "Codigo_IRT",
        "marca": "Marca",
    },
    {
        "estudio": "P&G",
        "tabla": "e_sv_pgladmar_irt.brz_ma12_sku",
        "pais": None,
        "categoria": "CATEGORIA",
        "nombre": "ID",
        "codigo": "Nombre",
        "marca": "marca",
    },
    {
        "estudio": "FIFCO",
        "tabla": "e_sv_fifco_irt.brz_in_sku_list",
        "pais": None,
        "categoria": "CATEGORIA",
        "nombre": "SKU_ENTRENAMIENTO",
        "codigo": "COD_ENTRENAMIENTO",
        "marca": "MARCA",
    },
    {
        "estudio": "FIFCO IRT",
        "tabla": "e_sv_fifco_rebate.brz_ma_sku",
        "pais": None,
        "categoria": "CATEGORIA",
        "nombre": "alias_irt",
        "codigo": "codigo_irt",
        "marca": "marca",
    },
    {
        "estudio": "Heineken",
        "tabla": "e_sv_heineken.brz_sku_list_madre",
        "pais": None,
        "categoria": "CATEGORIA",
        "nombre": "COD_DN",
        "codigo": "ALIAS",
        "marca": "Marca",
    },
    {
        "estudio": "Induveca",
        "tabla": "e_sc_induveca.brz_ma_sku",
        "pais": None,
        "categoria": "categoria",
        "nombre": "cod_dn_padre",
        "codigo": "alias_irt",
        "marca": "marca",
    },
    {
        "estudio": "PepsiCo RD",
        "tabla": "e_sc_pepsico_rd.brz_ma_sku",
        "pais": None,
        "categoria": "categoria",
        "nombre": "cod_dn_padre",
        "codigo": "alias_irt",
        "marca": "marca",
    },
    {
        "estudio": "San Miguel RD",
        "tabla": "e_sc_sanmiguel_rd.brz_ma_sku",
        "pais": None,
        "categoria": "categoria",
        "nombre": "cod_dn_padre",
        "codigo": "alias_irt",
        "marca": "marca",
    },
    {
        "estudio": "CBC Moderno EC",
        "tabla": "e_sc_cbc_moderno_ec.brz_ma_sku",
        "pais": None,
        "categoria": "categoria",
        "nombre": "cod_dn_padre",
        "codigo": "alias_irt",
        "marca": "marca",
    },
    {
        "estudio": "Lindley",
        "tabla": "hive_metastore.e_sv_ko_lindley.brz_ma_sku_final",
        "pais": None,
        "categoria": "Categoria_SLP",
        "nombre": "sku_Para_Entrenamiento",
        "codigo": "COD_DN",
        "marca": "Sub_Marca_IRT",
    },
    {
        "estudio": "Tradicional Chile",
        "tabla": "e_sv_ko_trad_ch.brz_om_skupais",
        "pais": None,
        "categoria": "Categoria",
        "nombre": "Nombre_en_programa",
        "codigo": "Codigo_IRT",
        "marca": "Marca",
    },
    {
        "estudio": "Cruz Verde",
        "tabla": "e_sv_cruzverde_ch.brz_ma_sku",
        "pais": None,
        "categoria": "CATEGORIA",
        "nombre": "alias_irt",
        "codigo": "codigo_irt",
        "marca": "marca",
    },
]

BRAND_CANDIDATES = [
    "MARCA",
    "BRAND",
    "MARCA_PRODUCTO",
    "NOMBRE_MARCA",
    "MARCA_SLP",
    "MARCA_SKU",
    "DESCRIPCION_MARCA",
]


def normalize_name(value):
    value = unicodedata.normalize("NFD", str(value))
    return re.sub(r"[^A-Z0-9]", "", value.encode("ascii", "ignore").decode().upper())


def resolve_column(columns, requested):
    if requested is None:
        return None
    by_normalized_name = {normalize_name(column): column for column in columns}
    return by_normalized_name.get(normalize_name(requested))


def detect_brand_column(columns):
    by_normalized_name = {normalize_name(column): column for column in columns}
    for candidate in BRAND_CANDIDATES:
        match = by_normalized_name.get(normalize_name(candidate))
        if match:
            return match
    for column in columns:
        token = normalize_name(column)
        if "MARCA" in token or "BRAND" in token:
            return column
    return None


def source_column(name):
    return F.col(name).cast("string") if name else F.lit(None).cast("string")


diagnostic_rows = []
frames = []

for source in SOURCES:
    try:
        raw = spark.table(source["tabla"])
        columns = raw.columns
        ola_column = resolve_column(columns, "OlaID")
        code_column = resolve_column(columns, source["codigo"])
        country_column = resolve_column(columns, source["pais"])
        category_column = resolve_column(columns, source["categoria"])
        name_column = resolve_column(columns, source["nombre"])
        brand_column = resolve_column(columns, source.get("marca")) or detect_brand_column(columns)

        if not code_column:
            raise ValueError(f"No existe la columna de código {source['codigo']}")

        recent_waves = []
        current = raw
        if ola_column:
            recent_waves = [
                row["ola"]
                for row in raw.select(F.col(ola_column).alias("ola"))
                .where(F.col(ola_column).isNotNull())
                .distinct()
                .orderBy(F.col("ola").desc())
                .limit(3)
                .collect()
            ]
            if recent_waves:
                current = raw.where(F.col(ola_column).isin(recent_waves))

        selected = current.select(
            source_column(country_column).alias("Pais"),
            source_column(category_column).alias("Categoria"),
            source_column(name_column).alias("Nombre"),
            source_column(code_column).alias("Codigo_IRT"),
            source_column(brand_column).alias("Marca"),
            F.lit(source["estudio"]).alias("Estudio"),
            F.lit(source["tabla"]).alias("Tabla_Origen"),
        ).where(F.col("Codigo_IRT").isNotNull() & (F.trim("Codigo_IRT") != ""))

        row_count = selected.count()
        frames.append(selected)
        diagnostic_rows.append((
            source["estudio"],
            source["tabla"],
            code_column,
            brand_column or "NO ENCONTRADA",
            ", ".join(str(wave) for wave in recent_waves) if recent_waves else "Sin OlaID",
            row_count,
            "OK" if brand_column else "OK, pero sin columna de marca",
        ))
    except Exception as error:
        diagnostic_rows.append((
            source["estudio"],
            source["tabla"],
            source["codigo"],
            "NO REVISADA",
            "-",
            0,
            f"ERROR: {str(error)[:300]}",
        ))

if not frames:
    raise RuntimeError("Ninguna fuente pudo cargarse. Revisa el diagnóstico.")

maestros_irt_estudios = reduce(lambda left, right: left.unionByName(right), frames).withColumn(
    "Codigo_Imagen",
    F.upper(
        F.regexp_replace(
            F.trim(
                F.regexp_replace(
                    F.col("Codigo_IRT"),
                    r"(?i)[.](jpg|jpeg|png|webp|gif|bmp|avif)$",
                    "",
                )
            ),
            r"(?:_[0-9]+)+_*$",
            "",
        )
    ),
).select(
    "Pais",
    "Categoria",
    "Nombre",
    "Codigo_IRT",
    "Codigo_Imagen",
    "Marca",
    "Estudio",
    "Tabla_Origen",
)

maestros_irt_estudios.createOrReplaceTempView("maestros_irt_estudios")

diagnostic_schema = StructType([
    StructField("Estudio", StringType(), False),
    StructField("Tabla_Origen", StringType(), False),
    StructField("Columna_Codigo", StringType(), False),
    StructField("Columna_Marca", StringType(), False),
    StructField("Ultima_OlaID", StringType(), False),
    StructField("Filas", LongType(), False),
    StructField("Estado", StringType(), False),
])
diagnostico = spark.createDataFrame(diagnostic_rows, diagnostic_schema)

print("DIAGNÓSTICO DE FUENTES — revisa especialmente Columna_Marca y Estado")
for row in diagnostico.orderBy("Estudio").collect():
    print(
        f"{row['Estudio']} | olas: {row['Ultima_OlaID']} | "
        f"filas: {row['Filas']} | {row['Estado']}"
    )
display(diagnostico.orderBy("Estudio"))

print("TABLA CONSOLIDADA — usa Download CSV en este resultado para descargarla")
display(maestros_irt_estudios.orderBy("Estudio", "Codigo_Imagen"))
