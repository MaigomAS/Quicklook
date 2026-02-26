# Quicklook Monitor Window · Propuesta de color (coherente + diferenciada)

## Objetivo

Mantener la coherencia visual con la ventana principal (base azul científica), pero dando al **Quicklook Monitor Window** una identidad propia más inmersiva y moderna para uso en segunda pantalla.

## Diagnóstico rápido

- **Ventana principal**: tema claro con top bar oscuro azul marino y acentos azul medio.
- **Monitor Window actual**: ya usa tema oscuro, pero puede acercarse mejor a los acentos de la principal para verse como parte de la misma familia.

## Dirección visual recomendada

- **Familia cromática compartida**: mantener eje en azules fríos (navy/steel/cyan suave).
- **Diferenciación clara**: Monitor en modo oscuro “de laboratorio” con más profundidad (gradientes y superficies elevadas).
- **Lenguaje científico**: reservar colores cálidos para alertas o anomalías; visualización normal en azules.

## Sistema de color propuesto (tokens)

### 1) Superficies

- `--mw-bg-0` (fondo app): `#070E1A`
- `--mw-bg-1` (fondo elevado): `#0D1628`
- `--mw-bg-2` (cards): `#14233A`
- `--mw-bg-glass` (panel translúcido): `rgba(20, 35, 58, 0.72)`

### 2) Bordes y divisores

- `--mw-border-subtle`: `#2B3D5B`
- `--mw-border-strong`: `#3E5A85`

### 3) Tipografía

- `--mw-text-primary`: `#E8F0FF`
- `--mw-text-secondary`: `#B8C7E6`
- `--mw-text-muted`: `#8EA3C7`

### 4) Acentos funcionales

- `--mw-accent-primary` (acciones, foco): `#4C8DFF`
- `--mw-accent-secondary` (resaltes técnicos): `#63C7FF`
- `--mw-accent-soft`: `rgba(76, 141, 255, 0.20)`

### 5) Estados

- `--mw-success`: `#2ED3A1`
- `--mw-warning`: `#FFB020`
- `--mw-danger`: `#FF5D73`
- `--mw-info`: `#4C8DFF`

### 6) Escala de datos (heatmap/rate)

Uso recomendado para conservar lectura científica sin “ruido” visual:

1. `#102A43` (muy bajo)
2. `#1F4E79`
3. `#2E6DA4`
4. `#3F8FC5`
5. `#5FA8D3`
6. `#8DC3DD`
7. `#F4D35E` (umbral de atención)
8. `#EE964B`
9. `#F95738` (alto/anómalo)

> Nota: priorizar gradiente azul para valores normales y reservar naranja/rojo para extremos mejora interpretación operativa.

## Regla de coherencia entre ventanas

- **Principal** = “operación y control” (claro + top bar oscuro).
- **Monitor** = “observación intensiva” (oscuro completo).
- Compartir **mismo acento base azul** (`#4C8DFF` aprox.) para botones/links clave en ambas ventanas.
- Mantener semántica consistente de estados (verde=ok, ámbar=advertencia, rojo=error).

## Aplicación recomendada en Quicklook Monitor Window

- Fondo global: gradiente sutil `#070E1A → #0D1628`.
- Header monitor: superficie `--mw-bg-glass` con borde `--mw-border-subtle`.
- Cards de canal: `--mw-bg-2` + borde `--mw-border-subtle`; hover/focus con halo `--mw-accent-soft` y borde `--mw-accent-primary`.
- Títulos y métricas principales: `--mw-text-primary`; metadata en `--mw-text-secondary`.
- Botones secundarios: fondo transparente + borde `--mw-border-strong`; botón primario en `--mw-accent-primary`.

## Resultado esperado

Con este esquema, ambas ventanas se perciben como el mismo producto, pero con roles distintos:

- **coherencia de marca** por compartir familia azul y semántica,
- **diferenciación funcional** por contraste claro (principal) vs oscuro técnico (monitor),
- **lectura científica** mejorada al evitar paletas excesivamente cálidas en visualización normal.
