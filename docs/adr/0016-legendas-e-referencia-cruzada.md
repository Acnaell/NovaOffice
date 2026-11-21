# ADR 0016: Legendas, Índice de Ilustrações e Referência Cruzada

- Status: aceito
- Data: 2026-11-21

## Contexto

Trabalhos acadêmicos numeram figuras, tabelas, quadros, gráficos e equações ("Figura 1 – Mapa da
região", NBR 14724), listam essas legendas no começo ("LISTA DE FIGURAS", com as páginas) e citam
umas às outras no texto ("ver Figura 3", "ver página 12"). O Word faz isso em Referências →
Legendas (Inserir Legenda, Inserir Índice de Ilustrações, Atualizar Tabela, Referência Cruzada) com
os campos SEQ, TOC `\c`, REF e PAGEREF; o LibreOffice, com `text:sequence`, os índices de
ilustrações e de tabelas e as referências a sequências e marcadores. O documento já tem caracteres
marcados para notas (ADR 0012) e citações (ADR 0013) e o Sumário como parágrafos marcados (ADR 0010).

## Decisão

1. **A legenda é um parágrafo com o estilo Legenda** (`caption`, o "Caption" do Word e do
   LibreOffice): o rótulo digitado ("Figura "), o caractere `SEQ_CHAR` (U+E002) com a marca
   `seq {label}` e o resto do texto (" – Mapa", com o travessão da ABNT). Inserir Legenda põe o
   parágrafo acima ou abaixo do item do cursor (a tabela inteira, se o cursor está numa); acima é o
   padrão, como pede a ABNT. Os rótulos são Figura, Tabela, Quadro, Gráfico e Equação, e o usuário
   pode criar outros (até 32 letras, dígitos, espaços ou hífens).
2. **O número não é gravado.** É a ordem do caractere entre os do mesmo rótulo, calculada na tela
   (`captionFields` em captions.ts) e no núcleo (`CaptionFields`), com a mesma regra. Inserir,
   apagar ou mover uma legenda renumera as outras na hora.
3. **A referência cruzada é um caractere marcado.** `XREF_CHAR` (U+E003) leva a marca
   `xref {target, show, page?}` (no CRDT, `show:alvo[:página]`). O alvo é o marcador do parágrafo
   (`bookmark`, um atributo de parágrafo), criado quando a primeira referência aponta para ele.
   `show: label` mostra o texto do alvo até o número da legenda ("Figura 3") ou o título inteiro;
   `show: page` mostra a página. A tela calcula a página na hora; a gravada em `page` (a da
   inserção) é a que vai para os arquivos, como a página das entradas do Sumário. Alvo apagado:
   "Erro! Fonte de referência não encontrada.", como o Word. Ctrl+clique na referência leva ao alvo.
4. **O Índice de Ilustrações são parágrafos marcados** com `figureIndex {label, title, page}` (no
   CRDT, `t:rótulo` para o título e `página:rótulo` para as entradas), como o Sumário: o título
   ("LISTA DE FIGURAS", centralizado) e uma entrada por legenda do rótulo, com o texto da legenda,
   pontilhado e página. Atualizar Índice refaz as entradas de todos os índices e mantém os títulos;
   Ctrl+clique numa entrada vai para a legenda.
5. **Formatos.**
   - .docx: o número é um campo ` SEQ Figura \* ARABIC ` (espaços do rótulo viram "_"); o marcador
     "_Ref<id>" cobre só "Figura 3" na legenda (o texto inteiro num título), como o Word grava; a
     referência é ` REF _Ref<id> \h ` ou ` PAGEREF _Ref<id> \h `; o índice é um campo
     ` TOC \h \z \c "Figura" ` com as entradas no estilo "table of figures" e o título no estilo
     "Table of Figures Heading". Na leitura, REF e PAGEREF dentro de um Sumário ou índice ficam como
     texto, e só os marcadores que alguma referência usa entram no documento.
   - .odt: `text:sequence` (com `text:ref-name` na legenda referenciada) e `text:sequence-decls`;
     referências a legendas são `text:sequence-ref` (`category-and-value` ou `page`), e a títulos,
     `text:bookmark-ref` (`text` ou `page`) com `text:bookmark-start`/`end`; o índice é um
     `text:table-index` para Tabela e um `text:illustration-index` para os outros rótulos. As
     categorias do LibreOffice vão e voltam com os nomes internos dele (Figura ↔ "Figure",
     Tabela ↔ "Table"), que a interface dele traduz.
   - Texto, Markdown e HTML: o número e o texto da referência no lugar dos caracteres.

## Consequências

- Validado no LibreOffice 26.8 nos dois sentidos: o .docx e o .odt do Nova abrem com as legendas
  numeradas, os índices como índices de verdade e as referências como campos (ao abrir o .docx, o
  LibreOffice recalcula tudo); regravados por ele, voltam ao Nova com os mesmos rótulos, alvos,
  números e índices (os marcadores ganham os nomes dele, como "Ref_Figura1_label_and_number").
- Ao abrir um .odt, o LibreOffice mostra os números gravados até atualizar os campos; o Nova grava
  sempre os números certos.
- A página de uma referência nos arquivos é a da inserção (o núcleo não pagina); o Word e o
  LibreOffice a recalculam ao atualizar os campos.
- Legendas dentro de quadros de texto do LibreOffice (legenda de imagem flutuante) ainda não são
  lidas, como as próprias imagens flutuantes.
- Copiar e colar um parágrafo-alvo repete o marcador; a referência vai para o primeiro.
- Numeração por capítulo ("Figura 2.1") e as opções "texto da legenda" e "acima/abaixo" da
  referência do Word ficam para depois.
