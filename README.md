# Mapzer · KML/KMZ → Shapefile

Conversor 100% no navegador (sem servidor, sem upload). Hospedável direto no GitHub Pages.

```
index.html        interface (HTML + CSS)
js/converter.js   núcleo: GeoJSON -> .shp/.shx/.dbf/.prj/.cpg (sem dependências)
js/app.js         interface: leitura de KML/KMZ, mapa, download do .zip
tests/            testes do núcleo (Node 18+)
```

## Modos de saída (polígonos e linhas)

| Modo | Registros gerados |
|---|---|
| Polígonos simples | 1 por polígono (MultiPolígono do KML é desmembrado, atributos repetidos) |
| MultiPolígono por feição | 1 por Placemark (vários polígonos viram um MultiPolígono) |
| MultiPolígono único | 1 para o arquivo inteiro |

No formato shapefile não existe tipo "MultiPolygon" separado: tudo é o tipo Polygon (5),
e um multipolígono é um registro com várias partes.

## Rodar os testes
    node --test

## Publicar
GitHub → Settings → Pages → Deploy from branch → `main` / `(root)`.
