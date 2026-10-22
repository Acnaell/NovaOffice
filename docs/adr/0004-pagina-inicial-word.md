# ADR 0004: Página Inicial no modelo do Word

- Status: aceito
- Data: 2026-10-21

## Contexto

O Nova Text precisa ter as funções básicas do Microsoft Word, com a mesma organização, para quem já
usa o Word não ter de reaprender. A primeira fase é a aba Página Inicial. Faltavam no núcleo
atributos de parágrafo (alinhamento, recuo, entrelinhas, listas) e marcas (realce, sobrescrito), e
cada tecla reenviava e redesenhava o documento inteiro.

## Decisão

1. **Atributos de parágrafo no mapa do bloco.** `align`, `indent`, `lineSpacing`, `spaceBefore`,
   `spaceAfter` e `list` são chaves opcionais ao lado de `style` e `text` no `YMap` de cada parágrafo.
   Ausente significa o padrão, então documentos antigos abrem sem migração e duas pessoas podem mudar
   atributos diferentes do mesmo parágrafo ao mesmo tempo. Um único comando, `block.setAttr`, muda um
   atributo; o Enter copia os atributos para o parágrafo novo.
2. **Listas como atributo, não como bloco.** Uma lista é uma sequência de parágrafos com `list`; o
   nível é o `indent`. A numeração (1. → a. → i.) é calculada na interface. É o modelo do Word
   (`w:numPr` no parágrafo) e mantém o CRDT plano.
3. **Valores do OOXML.** Realce usa os nomes de `w:highlight`; sobrescrito/subscrito é `w:vertAlign`;
   recuo é em níveis de 1,27 cm; tamanhos em meios-pontos. A importação e exportação de .docx fica direta.
4. **Atalhos por idioma.** O perfil de atalhos acompanha o idioma da interface: o Word em português usa
   Ctrl+N para negrito e Ctrl+B para salvar; em inglês, o contrário.
5. **Remendos em vez da visão inteira.** `dispatch` devolve só a faixa de parágrafos alterada
   (`ViewPatch`, calculada a partir dos eventos de domínio); desfazer e refazer devolvem tudo. A
   interface aplica o remendo mantendo os objetos dos parágrafos intactos, e cada parágrafo é um
   componente memorizado que só é redesenhado quando muda.
6. **Fluxos do Word como teste.** `apps/desktop/e2e` dirige a interface real com o núcleo real e
   classifica cada fluxo do Word; roda no CI.

## Consequências

- Uma tecla custa o mesmo num documento de 10 ou de 2.000 parágrafos.
- Copiar grava HTML com o fragmento do Nova embutido num comentário: colar no Nova não perde nada;
  colar no Word ou no e-mail recebe HTML comum.
- Durante a composição de acentos (tecla morta, IME) a seleção do modelo fica congelada; o
  navegador escreve um texto provisório no DOM que é descartado no fim.
- Quebra de página, tabelas, imagens e paginação ficam para as fases Inserir e Layout.
