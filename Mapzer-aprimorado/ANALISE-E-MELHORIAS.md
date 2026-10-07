# Análise e melhorias — Mapzer

## Resultado

### Atualização 1.1.1 — mapa de fundo

- Fundo padrão fixado no endpoint oficial `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, sem depender de preferências antigas de provedores autenticados.
- Zoom nativo limitado a 19 no OSM; aproximações adicionais ampliam os tiles existentes.
- Carregamento, falhas e carregamento parcial agora são informados separadamente das delimitações.
- Botão para restaurar OpenStreetMap e recuperação automática quando provedores alternativos retornam erros de carregamento. Imagens de aviso retornadas pelo provedor como HTTP 200 não são detectadas automaticamente; nesse caso, use o botão de restauração.
- Camadas antigas são removidas antes da troca, incluindo sua atribuição, e a recuperação ocorre após o evento de falha para evitar interferir no processamento do Leaflet.
- Teste real no navegador com KML sintético em São Paulo: ruas e polígono visíveis; restauração de OpenStreetMap confirmada. 25 testes automatizados aprovados.
- Referência: [política oficial de tiles do OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/). Para uso via web, publique em HTTPS ou sirva em localhost; o provedor exige Referer válido. Disponibilidade depende de internet e do serviço externo.

Revisão do projeto fornecido em `KML-para-ShapeFile--main.zip`. A interface principal foi preservada; as mudanças priorizam integridade dos dados e confiabilidade da importação. O ZIP original não foi alterado.

## Problemas corrigidos

| Problema encontrado | Melhoria implementada |
| --- | --- |
| Um anel externo inválido era descartado e o furo seguinte podia virar a área externa | Rejeição do polígono com anéis inválidos, sem promover furos ou acrescentar área silenciosamente |
| Coordenadas inválidas eram removidas e os vértices restantes reconectados | Rejeição da parte inválida; remoção apenas de vértices consecutivos idênticos; rejeição de linhas sem extensão e anéis com área assinada zero |
| GeometryCollection gerava vários registros no modo por feição | Agrupamento por Placemark de origem, separadamente em cada camada de linhas e polígonos |
| Valores numéricos passavam por Number, arredondamento e corte | Strings numéricas são escritas diretamente; valores que não cabem no formato numérico são armazenados como texto |
| Description sobrescrevia um atributo descricao existente | Preservação dos dois campos quando ambos existem |
| Campos longos eram truncados sem aviso | Aviso na interface e arquivo avisos.txt; campos.json associa nomes originais aos nomes DBF |
| Arquivo inválido mantinha a conversão anterior disponível | Limpeza imediata do estado e desativação do botão até nova leitura válida |
| Duas leituras concorrentes podiam trocar o conteúdo e o nome exportado | Apenas a leitura mais recente atualiza o estado; troca de arquivo bloqueada durante exportação |
| Mapa recebia geometrias brutas, inclusive inválidas | Pré-visualização usa as geometrias normalizadas; falha do mapa não impede exportação |
| Atribuições dos provedores se acumulavam | Remoção da atribuição anterior antes de trocar tiles |
| index2.html continha outro conversor independente | URL antiga redireciona para a interface principal, evitando dois núcleos divergentes |

Também foram adicionados limite de 50 MB para arquivos de entrada, validação da raiz KML, mensagem para dependências ausentes, seleção repetida do mesmo arquivo e descrição mais clara dos modos de conversão.

## Validação realizada

- 23 testes automatizados aprovados: 7 existentes e 16 novos.
- Regressões de polígonos, multipartes, precisão de atributos, UTF-8 e nomes de campos.
- Verificação binária de cabeçalhos, offsets SHP/SHX, bounding box e contagem de registros DBF.
- Testes da interface com DOM simulado: corrida entre leituras, arquivo inválido, ausência de mapa e exportação em andamento.
- Verificação sintática de app.js e converter.js.
- Execução neste ambiente com Node 24 e `node --test --test-isolation=none tests/*.test.js`, pois a criação de subprocessos do executor padrão foi bloqueada.

## Limites e próximos passos

- A revisão inicial não incluiu navegador real. Na atualização 1.1.1, importação de KML e mapa foram verificados em navegador real. KMZ e abertura dos arquivos em QGIS/ArcGIS ainda não foram validados manualmente.
- Não há validação topológica completa: interseções, posição dos furos e polígonos que cruzam o antimeridiano ainda precisam de tratamento especializado.
- A saída permanece WGS84 2D, descartando altitude. Não há reprojeção para UTM.
- O limite do KML extraído é verificado depois da descompressão; não é proteção completa contra KMZ de expansão excessiva. Arquivos grandes ainda são processados na thread principal.
- Textos DBF ficam limitados a 254 bytes UTF-8, agora com aviso; programas GIS podem interpretar UTF-8 de formas diferentes. Precisão já perdida antes de chegar ao conversor como Number não pode ser recuperada.
- Bibliotecas e mapas continuam dependendo de serviços externos. Os arquivos são processados localmente, mas o navegador faz solicitações de scripts e tiles; isto não é funcionamento totalmente offline.
- A integração Google Maps existente foi preservada, mas não validada. Ela utiliza URLs diretas de tiles e guarda a chave em localStorage; deve passar por revisão específica da API e das restrições da chave antes de uso em produção. As instruções anteriores em GOOGLE_MAPS_SETUP.md não foram revalidadas.

## Uso

Abra `index.html`, escolha um KML/KMZ, selecione o modo e clique em **Gerar Shapefile (.zip)**. O projeto continua estático e pode ser publicado no GitHub Pages. Nenhuma publicação foi feita nesta revisão.
