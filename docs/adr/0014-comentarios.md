# ADR 0014: Comentários

- Status: aceito
- Data: 2026-10-30

## Contexto

Revisar um texto a várias mãos pede comentários como os do Word (Revisão → Novo Comentário,
Ctrl+Alt+M): um trecho destacado no texto e um balão na margem com autor, data, respostas e a opção
de resolver. O documento é uma lista de parágrafos no CRDT (ADR 0007) e já guarda as notas de
rodapé com um padrão parecido (ADR 0012).

## Decisão

1. **O trecho é uma marca.** Os caracteres comentados levam a marca `comment {id}`. Ela anda com o
   texto em digitar, apagar, desfazer e coedição, e pode atravessar parágrafos. Digitar logo depois
   do fim do trecho não o estende (como no Word e como os links).
2. **O comentário fica nas configurações do documento**, na chave `cm:<id>`, em JSON: autor,
   iniciais, data (ISO 8601 em UTC), texto, resolvido e, nas respostas, `parent`. O comando
   `comment.set {id, value}` grava; `value: null` apaga. Respostas não marcam o texto.
3. **Um trecho, um comentário.** Cada caractere tem no máximo um comentário: um novo comentário
   sobre um trecho que já tem outro fica com a parte em comum, e o antigo, com o resto.
4. **Criar e excluir são um passo de desfazer cada.** Criar marca o trecho e grava o comentário no
   mesmo lote. Excluir tira a marca e apaga o comentário e as respostas. O comentário novo só existe
   depois de "Comentar": até lá, o trecho fica destacado (CSS Custom Highlight API) e nada vai para o
   documento.
5. **Tela.** Os balões ficam numa coluna à direita do papel, na altura do trecho, empilhados sem se
   sobrepor. O comentário do cursor (ou o balão clicado) fica ativo: trecho mais forte, balão
   alinhado, campo de resposta. Os resolvidos ficam esmaecidos, sem destaque no texto. O autor é o
   nome que a pessoa digita no primeiro comentário, guardado nas preferências.
6. **Formatos.**
   - .docx: `word/comments.xml` (autor, data, iniciais, texto) e `word/commentsExtended.xml`
     (resolvido e respostas, pelo `w14:paraId`), como o Word 2013+. No texto,
     `w:commentRangeStart`/`End` e o `w:commentReference`. Respostas recebem o mesmo trecho do
     comentário respondido.
   - Na leitura do .docx, respostas sem `commentsExtended` (o LibreOffice grava assim) são
     reconhecidas pela referência logo depois da do comentário respondido, ou pelo trecho escondido
     por outro.
   - .odt: `office:annotation` no início e `office:annotation-end` no fim do trecho, com
     `dc:creator`, `dc:date` e `meta:creator-initials`; `loext:resolved` e `loext:parent-name` como o
     LibreOffice. Comentário sem `annotation-end` (sem seleção) marca um caractere.
   - Markdown, HTML e texto: os comentários ficam de fora.

## Consequências

- Copiar e colar não leva o comentário: a cópia sai sem a marca (o Word cria um comentário novo).
- Comentários sobrepostos de outros programas viram trechos sem sobreposição: vale o último aberto.
- Na impressão e no PDF, os balões não aparecem.
- Comentário com formatação (negrito, links) ainda não é suportado: o texto é simples.
