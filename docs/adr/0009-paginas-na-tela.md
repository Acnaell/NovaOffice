# ADR 0009: Páginas na tela sem dividir o editor

- Status: aceito
- Data: 2026-10-22

## Contexto

O Nova Text mostrava o documento numa folha contínua. Para a aba Layout (papel, margens,
orientação) e, depois, para cabeçalho, rodapé e número de página, o texto precisa aparecer em
páginas como no Word. O editor é um único elemento `contenteditable`, e cursor, seleção, IME e
colar dependem disso.

## Decisão

1. **A página é uma configuração do documento.** O mapa `settings` do CRDT guarda o papel e as
   margens em twips, como o `w:sectPr` do Word. Ele entra no desfazer. O comando é `page.set`.
2. **Um editor só, folhas atrás.** O texto continua num único `contenteditable`, com a largura do
   papel e as margens como espaçamento interno. As folhas brancas são desenhadas atrás dele, uma por
   página.
3. **Paginação por empurrão.** Depois de cada desenho (`paginate.ts`), o programa mede de uma vez a
   altura e a posição de cada parágrafo e tabela. Cada um que passaria do fim da área de texto de uma
   página, ou que começa com quebra de página, ganha uma margem de cima extra que o leva ao começo da
   página seguinte. O cálculo considera o colapso de margens. Escrever depois de medir evita refazer
   o layout a cada parágrafo. Antes de imprimir, os empurrões são desfeitos, e o navegador pagina
   com o `@page` do documento.
4. **Limites aceitos agora.** Um parágrafo ou tabela maior que uma página inteira não é dividido
   entre páginas e fica como está. Linhas viúvas e órfãs não são controladas.

## Consequências

- A posição do cursor e o texto não mudam, só o desenho. Por isso o desfazer, a colaboração e os
  testes de digitação continuam valendo.
- Com 2.000 parágrafos, cada tecla custa cerca de 25 ms (antes, cerca de 13 ms).
- Cabeçalho, rodapé e número de página podem ser desenhados em cada folha, porque a posição de cada
  página já é conhecida.
