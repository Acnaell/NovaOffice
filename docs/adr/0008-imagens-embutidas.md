# ADR 0008: Imagens embutidas no documento

- Status: aceito
- Data: 2026-10-22

## Contexto

O Word e o LibreOffice guardam as imagens dentro do arquivo, e o Nova Text precisa abri-las, mostrá-las
e salvá-las de volta. O documento é um CRDT (Yrs) que também serve para a colaboração. Uma imagem
precisa chegar a todas as cópias sem pesar em cada tecla digitada.

## Decisão

1. **Arquivos num mapa à parte do CRDT.** Os arquivos ficam no mapa `media` do documento: id →
   `{mime, data}`, com os bytes em `Any::Buffer`. Esse mapa fica fora do desfazer: desfazer a inserção
   tira o parágrafo, e o arquivo fica guardado sem uso. O id é um hash do conteúdo (FNV-1a), então a
   mesma imagem inserida duas vezes é guardada uma vez.
2. **A imagem é um atributo do parágrafo.** O parágrafo leva `image: {id, width, height}`, com o
   tamanho em pontos, como as imagens "Alinhadas com o Texto" do Word. O alinhamento é o do parágrafo.
   O Enter não leva a imagem para o parágrafo novo.
3. **A interface não recebe os bytes junto com o documento.** A visão do documento traz só o id. A
   interface pede o arquivo uma vez (`media(id)`, um data URL) e guarda num cache, porque o conteúdo de
   um id nunca muda. Inserir é feito em duas etapas: `add_image_file`/`add_image_data` guarda o arquivo
   e devolve a referência, e depois `block.insert` e `block.setAttr` criam o parágrafo. Assim a
   inserção entra no desfazer.
4. **Tipos aceitos:** PNG, JPEG, GIF, BMP e WebP, reconhecidos pelo cabeçalho do arquivo, até 25 MB.
   SVG fica de fora, porque o Word exige uma cópia em PNG junto.
5. **Formatos.**
   - .docx: `w:drawing`/`wp:inline` com relação `image` e `word/media/`. Ao ler, `wp:extent` dá o
     tamanho. Imagens no meio do texto viram um parágrafo próprio antes do texto.
   - .odt: `draw:frame`/`draw:image` e `Pictures/`.
   - .html e Markdown: a imagem vai embutida como data URL, para o arquivo abrir sozinho.

## Consequências

- Imagens flutuantes (com texto em volta), recorte, bordas e efeitos ainda não existem. Ao ler, elas
  viram imagens alinhadas com o texto.
- Arquivos sem uso continuam dentro do .nova até uma limpeza futura. Nos .docx e .odt só entram as
  imagens usadas.
