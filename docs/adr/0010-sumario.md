# ADR 0010: Sumário como parágrafos marcados

- Status: aceito
- Data: 2026-10-23

## Contexto

Trabalhos acadêmicos (TCC, ABNT) e relatórios precisam do Sumário automático do Word: uma lista dos
títulos com pontilhado e o número da página de cada um, que se atualiza com um clique e vai para o
.docx e o .odt. O documento é uma lista plana de parágrafos (ADR 0007), e as páginas só existem na
tela, depois da paginação (ADR 0009). O núcleo não sabe em que página cada título cai.

## Decisão

1. **Cada parágrafo do sumário leva `toc: {level, page}`.** O nível 0 é o título do sumário; os
   níveis 1 a 6 são as entradas, uma por título. O texto da entrada é o texto do título. Os parágrafos
   seguidos com `toc` formam o sumário. No CRDT, o atributo é o texto `"nível:página"`.
2. **A página guardada é a da última atualização**, como o resultado guardado do campo TOC do Word.
   É ela que vai para o arquivo. Na tela, o número é calculado depois de cada paginação: cada entrada
   é ligada ao título pelo texto, na ordem do documento, e recebe a página real dele (`data-page`).
3. **Inserir, Atualizar e Remover** são comandos que já existem (`block.insert`, `block.setAttr`,
   `block.remove`) num `batch`, ou seja, um passo de desfazer. Ficam em `apps/desktop/src/toc.ts`, sem
   DOM e com testes. Atualizar refaz todas as entradas com os títulos 1 a 3 e as páginas da tela;
   o título do sumário fica.
4. **Desenho.** O pontilhado é o fundo da última linha da entrada, e o texto e o número o cobrem com
   o branco do papel. Ctrl+clique numa entrada leva ao título.
5. **Formatos.**
   - .docx: estilos "TOC Heading" e "toc 1" a "toc 6", tab à direita com pontilhado na largura do
     texto e o campo `TOC \o "1-3" \h \z \u` em volta das entradas. O Word e o LibreOffice o
     reconhecem como sumário e podem atualizá-lo.
   - .odt: `text:table-of-content` com os modelos de entrada e as entradas no `text:index-body`
     (estilos "Contents Heading" e "Contents 1"…).
   - Ao abrir, valem os mesmos estilos. O número depois do último tab vira a página guardada. Também
     é lido o título do sumário fora do índice, que o LibreOffice grava assim ao converter um .docx.

## Consequências

- Se um título muda e o sumário não é atualizado, a entrada continua com o texto antigo, como no
  Word. A tela some com o número dessa entrada até a atualização.
- Só o primeiro sumário do documento é atualizado e removido pela faixa de opções.
- As entradas no arquivo não são links para marcadores nos títulos: o Word e o LibreOffice refazem
  os links quando o sumário é atualizado neles.
