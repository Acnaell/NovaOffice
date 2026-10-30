# ADR 0011: Design da página (cor, marca d'água e bordas)

- Status: aceito
- Data: 2026-10-30

## Contexto

A aba Design do Word tem o grupo Plano de Fundo da Página: Cor da Página, Marca d'Água e Bordas da
Página. São configurações do documento inteiro, como o papel e as margens (ADR 0009) e o cabeçalho
(mapa `settings` do CRDT). Precisam aparecer nas folhas da tela, sair na impressão e no PDF e ir e
voltar no .docx e no .odt sem perder nada no Word nem no LibreOffice.

## Decisão

1. **Modelo.**
   - A cor e a borda fazem parte da página: `PageSetup.background: Option<String>` (`#RRGGBB`) e
     `PageSetup.border: Option<PageBorder>` (`single` = Caixa, `shadow` = Sombra, `double` = Dupla;
     cor; espessura em oitavos de ponto, de 2 a 48, como o `w:sz` do Word). Mudam com o `page.set` de
     sempre, então a aba Layout e a aba Design dividem o mesmo comando e o mesmo desfazer. No JSON os
     dois campos são opcionais: os comandos antigos continuam valendo (e tiram cor e borda).
   - A marca d'água é um campo próprio, `watermark.set` com `Watermark {text, color,
     semitransparent, layout}` (`diagonal` ou `horizontal`) ou `null`. Fica no mapa `settings` do
     CRDT (`watermarkText`…), como o cabeçalho, e cada mudança é um passo de desfazer.
   - O núcleo valida: cor `#RRGGBB`, texto de 1 a 200 caracteres sem quebra de linha. Ao abrir um
     arquivo, `load_watermark` e `load_page_setup` não entram no desfazer. O código fica em
     `nova-domain-text/src/design.rs` e `nova-app/src/design.rs`.
2. **A caixa da marca d'água é calculada igual em todo lugar** (`watermark_size` no Rust,
   `watermarkSize` no TypeScript, testados com os mesmos números): na diagonal, 65% da diagonal da
   área de texto; na horizontal, a largura dela; a altura sai do número de letras. O texto estica até
   a caixa, como o `fitshape` do Word, e fica no centro da área de texto.
3. **Tela.** Cada folha (`.sheet`) desenha a borda a 24 pt da beira do papel e a marca d'água (SVG
   com `textLength`), atrás do texto. A cor vira `--page-bg` do papel, com o texto claro sobre cores
   escuras; o pontilhado do sumário continua coberto pela cor do papel.
4. **Impressão e PDF.** O Chromium (WebView2) tem três limites, medidos em PDFs gerados por ele:
   não pinta o fundo do `@page` quando ele tem borda ou contorno; recorta camadas `position: fixed`
   na área de texto; e só imprime fundos com `print-color-adjust: exact`. Por isso:
   - a cor e a borda vão nas 16 **caixas de margem** do `@page`, como fundo (a borda são gradientes
     de uma cor, a 24 pt da beira), declaradas antes das do cabeçalho e rodapé (`printBoxes`), que só
     trocam o `content`. O cabeçalho continua dentro da borda, como no Word;
   - a área de texto recebe a cor pelo fundo do `html`, e os fundos brancos da janela ficam
     transparentes;
   - a marca d'água é uma camada fixa (`PrintDesign`), que o navegador repete em cada página, no
     centro da área de texto, atrás do texto.
5. **Formatos.**
   - .docx: `w:background` no `w:document` com `w:displayBackgroundShape` no settings.xml; borda em
     `w:pgBorders w:offsetFrom="page"` (24 pt, `w:shadow` na Sombra); marca d'água como o Word grava:
     forma VML `PowerPlusWaterMarkObject` com `v:textpath` (tipo 136), `rotation:315` na diagonal e
     `v:fill opacity=".5"` quando semitransparente, no header1.xml. Com Primeira Página Diferente, um
     header2.xml (`first`) só com a marca d'água.
   - .odt: `fo:background-color` (e `draw:fill-color`) e `fo:border` no
     `style:page-layout-properties`, `style:shadow` na Sombra, `style:border-line-width` na Dupla. No
     LibreOffice a borda fica na margem e o texto começa depois do enchimento: a margem vira 24 pt e
     o resto vai para `fo:padding`, para a área de texto não mudar. Marca d'água como o LibreOffice
     grava: `draw:custom-shape` fontwork no cabeçalho do estilo de página, com estilo gráfico de
     cor e opacidade.
   - Com cabeçalho ou rodapé, o .odt grava como o LibreOffice grava um .docx: a margem do estilo
     de página vai até o cabeçalho (708 twips, a distância do `w:pgMar w:header` do .docx) e o
     cabeçalho ocupa o resto da margem do Nova (`fo:min-height`, com `style:dynamic-spacing`). O
     texto começa na margem do Nova e a conversão para .docx devolve a mesma margem.
   - Ao abrir, valem também o que o LibreOffice grava: `v:fill` depois do texto, cor por nome
     (`red`, `silver`), `default-page-layout` antes da página e cabeçalho dentro da margem
     (`fo:min-height` somado à margem).
6. **Validação.** Os testes de ida e volta (`formats.rs`) cobrem .docx, .odt e .nova. Os arquivos
   foram abertos e convertidos no LibreOffice 26.8 nos dois sentidos (.docx → .odt e .odt → .docx) e
   relidos pelo Nova sem perda; os trechos que o LibreOffice grava viraram testes.

## Consequências

- Só uma marca d'água de texto (sem imagem) e uma borda igual nos quatro lados, sem bordas
  artísticas. Bordas diferentes por lado, vindas do Word, abrem com a do primeiro lado que tiver linha.
- A sombra impressa e na tela é uma faixa da cor da borda; o Word desenha a dele um pouco diferente.
- Na impressão, as emendas entre as caixas de margem podem mostrar um fio claro em alguns leitores de
  PDF com suavização.
- Ao abrir um .odt com cabeçalho, a margem de cima soma a altura do cabeçalho do LibreOffice, para a
  área de texto ficar onde ele a mostra.
