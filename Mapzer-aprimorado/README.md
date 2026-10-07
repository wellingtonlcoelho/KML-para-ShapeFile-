# Mapzer · KML/KMZ → Shapefile

Versão aprimorada 1.1.1. Consulte [ANALISE-E-MELHORIAS.md](ANALISE-E-MELHORIAS.md) para correções, testes e limitações.

O mapa de fundo inicia em OpenStreetMap, sem chave de API, e permanece igual nos temas claro e escuro. Se houver falha, use **Restaurar mapa OpenStreetMap**. Provedores alternativos precisam ser selecionados explicitamente a cada sessão. Para publicação, substitua também os arquivos da pasta `js`; a página referencia a versão nova de `app.js` para evitar reutilizar o script antigo do cache.

Abra `index.html` para usar. `index2.html` redireciona à interface principal.
O ZIP exportado inclui `campos.json` com a correspondência dos atributos e, quando necessário, `avisos.txt` sobre truncamento de textos.
Entrada limitada a 50 MB; saída WGS84 em duas dimensões. Bibliotecas e mapas requerem conexão externa.

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
