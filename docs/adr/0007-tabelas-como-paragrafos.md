# ADR 0007: Tabelas como parágrafos marcados com a célula

- Status: aceito
- Data: 2026-10-22

## Contexto

O Nova Text precisa de tabelas como as do Word: inserir, digitar, Tab entre células, inserir e
excluir linhas e colunas, e abrir e salvar tabelas de .docx e .odt. O documento é uma lista plana
de parágrafos no CRDT (Yrs), e toda a interface trabalha com posições `{bloco, offset}`: cursor,
seleção, copiar e colar, localizar, desfazer, remendos de visão.

Uma tabela aninhada no CRDT (mapa de linhas, cada uma com células, cada uma com parágrafos) mudaria
o endereçamento de tudo isso e exigiria um modelo de seleção novo.

## Decisão

1. **Cada parágrafo de uma tabela leva `cell: {table, row, col}`.** Uma tabela é a sequência de
   parágrafos seguidos com o mesmo `table`, em ordem de linha e coluna. Uma célula pode ter vários
   parágrafos, como no Word. No CRDT, `cell` é uma chave de atributo do parágrafo, gravada como o
   texto `"tabela:linha:coluna"`. Arquivos antigos abrem sem migração.
2. **Tudo o que já funciona com parágrafos continua funcionando.** O Enter divide o parágrafo e
   copia os atributos, então o parágrafo novo fica na mesma célula. Copiar, colar, localizar,
   formatar e desfazer não mudam.
3. **Estrutura por comandos que já existem.** Inserir tabela, linha ou coluna usa `block.insert` e
   `block.setAttr`; excluir usa `block.remove`. Tudo vai num `batch`, que é um passo de desfazer. As
   operações ficam em `apps/desktop/src/tables.ts`, sem DOM, com testes que simulam os comandos.
4. **Proteções de edição na interface.** Backspace e Delete não juntam parágrafos de células
   diferentes. Apagar uma seleção que atravessa células apaga só o texto de cada parágrafo, sem
   juntar parágrafos. Colar dentro de uma célula põe tudo na célula. Colar uma tabela copiada fora
   de tabela gera um id novo, para não se juntar à original.
5. **Desenho.** A interface agrupa os parágrafos seguidos de cada tabela num `<table>` e põe cada um
   na célula `[linha][coluna]`. Os elementos continuam com `data-block`, então o mapeamento entre o
   DOM e o modelo não muda.
6. **Formatos.**
   - .docx: `w:tbl` com a Grade da Tabela (bordas simples), colunas iguais e sombreamento de célula
     em `w:tcPr`. Ao ler, `w:gridSpan` vira uma célula só. Tabelas aninhadas ficam dentro da célula
     de fora.
   - .odt: `table:table` com estilos de célula (bordas e fundo).
   - Também .html e Markdown, nas tabelas do GitHub, com `<br>` entre parágrafos da célula.

## Consequências

- Larguras de coluna, células mescladas e bordas personalizadas ainda não são guardadas. Ao salvar,
  as colunas saem com a mesma largura.
- Duas pessoas que mudam a estrutura da mesma tabela ao mesmo tempo (por exemplo, inserir colunas)
  podem deixar células com coordenadas repetidas ou faltando. A interface desenha mesmo assim:
  células que faltam aparecem hachuradas e os parágrafos repetidos ficam juntos na célula. Uma
  normalização no núcleo pode vir depois.
