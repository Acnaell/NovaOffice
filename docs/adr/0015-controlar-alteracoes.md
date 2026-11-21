# ADR 0015: Controlar Alterações

- Status: aceito
- Data: 2026-11-21

## Contexto

Quem troca documentos com o Word revisa com Controlar Alterações (Revisão, Ctrl+Shift+E): o texto
digitado aparece marcado, o texto apagado fica riscado, e alguém aceita ou rejeita cada mudança.
Até aqui, um .docx com alterações do Word abria no Nova sem o texto excluído e sem a marcação, e
quem revisava no Nova não deixava rastro.

## Decisão

1. **A revisão é uma marca de caractere.** Duas marcas novas: `ins {autor, data}` e
   `del {autor, data}`, gravadas no CRDT como `data|autor`. O texto excluído continua no documento,
   com a marca `del`, até a exclusão ser aceita. Assim a revisão anda com o texto em desfazer,
   coedição e cópia, como as outras marcas.
2. **O núcleo transforma as edições.** Com o controle ligado, a interface manda as edições dentro de
   `{"type":"tracked","author","date","commands":[…]}`. O núcleo:
   - marca o texto inserido com `ins`, herdando a formatação do texto ao lado;
   - troca cada exclusão por `del` no trecho. Uma inserção ainda não aceita do mesmo autor sai de
     vez, como no Word;
   - num lote, desloca as posições dos comandos seguintes, porque eles foram calculados como se o
     texto excluído tivesse saído (`Shift` em `track.rs`). Assim "trocar a seleção" põe o texto novo
     depois do riscado.
3. **O estado fica no documento.** `review.setTracking {on}` grava o modo nas configurações. No
   .docx vira `w:trackRevisions` e no .odt `text:track-changes`; o arquivo abre com o controle
   ligado, como no Word.
4. **Aceitar e rejeitar são comandos comuns**, fora do controle:
   - aceitar uma inserção tira a marca `ins`; aceitar uma exclusão apaga o texto;
   - rejeitar faz o contrário;
   - os comandos vão de trás para a frente, num passo de desfazer;
   - o núcleo também tem `revisions()` e `resolve_all()`.
5. **Tela.**
   - Inserido sublinhado e excluído riscado, na cor de cada autor, com a dica "Inserido por …".
   - Uma barra na margem marca os parágrafos alterados.
   - Toda a Marcação, Sem Marcação (como ficaria aceitando tudo) e Original escondem o texto pelo
     CSS, sem mudar o documento.
   - O nome do autor é pedido ao ligar o controle pela primeira vez. É o mesmo dos comentários.
   - O corretor não vê o texto excluído.
6. **Formatos.**
   - .docx: `w:ins` e `w:del` (com `w:delText`) em volta das execuções. Na leitura, `w:moveTo` e
     `w:moveFrom` viram inserção e exclusão. Mudanças só de formatação (`w:rPrChange` e afins) são
     ignoradas: fica a formatação atual.
   - .odt: `text:tracked-changes` com as regiões. Inserções ficam entre `text:change-start` e
     `text:change-end`; exclusões ficam na região, com `text:change` no lugar.
   - Markdown, HTML e texto: saem com as alterações aceitas.

## Consequências

- Quebras de parágrafo e formatação não são controladas: Enter, Backspace no começo do
  parágrafo e negrito entram direto.
- Uma exclusão entre parágrafos deixa todos eles, com o texto riscado, sem juntar.
- No .odt, o texto excluído perde a formatação: a região guarda só o texto.
- O LibreOffice grava as alterações dele sem o atributo `text:track-changes` (que vale `true` por
  padrão), e o Nova segue o padrão.
