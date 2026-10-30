# ADR 0012: Notas de rodapé

- Status: aceito
- Data: 2026-10-30

## Contexto

Trabalhos acadêmicos e relatórios usam notas de rodapé (Referências → Inserir Nota de Rodapé, Ctrl+Alt+F
no Word): um número sobrescrito no texto e o texto da nota no pé da mesma página, numerados em ordem.
O documento é uma lista plana de parágrafos no CRDT (ADR 0007), e as páginas só existem na tela
(ADR 0009).

## Decisão

1. **A chamada é um caractere marcado no texto.** A nota é o caractere U+E000 (uso privado) com a
   marca `footnote {id}`. Ele anda junto com o texto em digitar, apagar, copiar, colar, desfazer e
   coedição, como qualquer letra. Apagar o caractere remove a nota do documento.
2. **O texto da nota fica nas configurações do documento** (o mapa `settings` do CRDT, que entra no
   desfazer), uma chave por nota: `fn:<id>`. O comando `footnote.set {id, text}` grava, e
   `text: null` apaga. Notas sem chamada no texto são ignoradas na tela e ao salvar.
3. **O número não é guardado.** É a ordem das chamadas no documento (1, 2, 3…), recalculada a cada
   desenho, como no Word.
4. **Na tela**, a chamada aparece como número sobrescrito. As notas da página ficam no pé dela,
   acima da margem de baixo, separadas por um traço curto. A paginação reserva a altura das notas
   de cada página antes de decidir o que cabe nela. A nota se edita ali mesmo: clique, digite, e
   Esc ou um clique fora volta para o texto.
5. **Formatos.**
   - .docx: `word/footnotes.xml`, com os separadores que o Word exige, `w:footnoteReference` no
     texto e os estilos "footnote text" e "footnote reference".
   - .odt: `text:note` com `text:note-class="footnote"`, a citação e o corpo.
   - Markdown: `[^n]` com as definições no fim. HTML: número sobrescrito com link e a lista de
     notas no fim.
   - Texto puro: `[n]`.

## Consequências

- Na impressão pelo navegador (Imprimir e "Salvar como PDF"), a paginação é refeita pelo
  navegador, que não sabe montar o pé de cada página: as notas saem numa lista no fim do documento.
  O .docx e o .odt levam as notas de rodapé de verdade.
- Nota com formatação (negrito, itálico, links) ainda não é suportada: o texto da nota é simples,
  e a formatação de notas vindas do Word se perde.
- Desfazer volta primeiro o texto digitado na nota (gravado ao sair dela) e depois a nota inteira.
- Copiar e colar uma chamada no mesmo documento repete a mesma nota (mesmo id), em vez de criar uma
  cópia.
- A altura das notas na tela é estimada pela largura do texto. Uma nota muito longa pode passar um
  pouco da margem de baixo.
- Notas de fim (endnotes) ficam para depois.
