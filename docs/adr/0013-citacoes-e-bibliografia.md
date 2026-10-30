# ADR 0013: Citações e Bibliografia (ABNT)

- Status: aceito
- Data: 2026-10-30

## Contexto

Trabalhos acadêmicos no Brasil seguem a ABNT: chamadas autor-data no texto, como
"(SILVA, 2026, p. 12)" (NBR 10520), e a lista "REFERÊNCIAS" no fim (NBR 6023). O Word tem
Referências → Citações e Bibliografia (Inserir Citação, Gerenciar Fontes, Bibliografia), com as
fontes num `customXml` do .docx. O documento já tem um caractere marcado para as notas de rodapé
(ADR 0012), dados em JSON nas configurações para os comentários (ADR 0014) e o Sumário como
parágrafos comuns marcados (ADR 0010).

## Decisão

1. **A fonte fica nas configurações do documento**, na chave `src:<id>`, em JSON: tipo (livro,
   artigo, site, tese), autores (sobrenome e prenomes; entidade só com o sobrenome), título (o que
   vem depois de ": " é o subtítulo), ano, editora ou nome do site, local, edição, periódico, volume,
   número, páginas, instituição, tipo de trabalho, URL e data de acesso. O comando
   `source.set {id, value}` grava e `value: null` apaga, dentro do desfazer, como `comment.set`.
2. **A chamada é um caractere marcado.** O caractere `CITATION_CHAR` (U+E001, ao lado do U+E000 da
   nota) leva a marca `citation {id, page?}` (no CRDT, `id` ou `id:página`). A marca só fica num
   texto feito só desse caractere: digitar ao lado da chamada não vira citação. Um caractere próprio,
   em vez do da nota, deixa o código das notas como está.
3. **O texto da chamada é gerado, não gravado**: `citation_text` no núcleo e `citationText` na tela,
   com a mesma regra (NBR 10520, autor em maiúsculas como pedido): até três autores separados por
   ";", quatro ou mais com "et al.", sem autor a primeira palavra do título com "...", sem ano
   "[s. d.]", página com ", p. ". Mudar a fonte muda todas as chamadas.
4. **A bibliografia são parágrafos comuns** marcados com `bibliography` (`title` ou `entry`), como
   o Sumário: o título "REFERÊNCIAS" é Título 1 centralizado (entra no Sumário, como pede a ABNT) e as
   entradas seguem a NBR 6023 (ordem alfabética, sobrenome em maiúsculas, destaque do título em
   negrito sem o subtítulo, "[S. l.: s. n.]", "Disponível em" e "Acesso em"), espaço simples e uma
   linha em branco entre elas. Inserir Bibliografia lista todas as fontes do documento (como o Word);
   Atualizar Bibliografia refaz as entradas e mantém o título.
5. **Formatos.**
   - .docx: as fontes em `customXml/item1.xml` (`b:Sources`, com `itemProps1.xml` e a relação
     `customXml` no documento); tese é `Report` com `b:ThesisType` e `b:Institution`. Cada chamada é
     um campo `CITATION <id> \l 1046 \p "<página>"` num `w:sdt` com `w:citation`, com o texto da
     chamada como resultado. A bibliografia fica num `w:sdt` da galeria "Bibliographies" e as
     entradas, no estilo "Bibliography", dentro de um campo `BIBLIOGRAPHY`. Na leitura, o resultado
     de um campo `CITATION` com fonte conhecida vira a chamada; sem fonte, fica como texto.
   - .odt: cada chamada é um `text:bibliography-mark` com os dados da fonte (data de acesso em
     `text:custom1`). O identificador é o texto da chamada sem os parênteses, e a configuração da
     bibliografia usa "(" e ")" como prefixo e sufixo, para o LibreOffice mostrar
     "(SILVA, 2026, p. 12)". O ODF não tem página por chamada: ela é lida de volta do texto da
     marca. Marcas com os mesmos dados viram uma fonte só. A bibliografia é um `text:bibliography`
     com o título no `text:index-title`.
   - Texto, Markdown e HTML: a chamada vira o texto dela.

## Consequências

- Validado no LibreOffice 26.8: o .odt do Nova abre com as chamadas certas e volta com fontes,
  páginas e bibliografia; o .docx do Nova abre com as chamadas certas.
- O LibreOffice não lê o `b:Sources` do .docx nem o grava: um .docx regravado por ele volta ao Nova
  com as chamadas como texto e sem as fontes.
- Fontes que só existem no .odt sem nenhuma chamada se perdem (o ODF guarda a fonte na marca).
- Uma chamada cita uma fonte; `CITATION` com várias fontes (`\m`) fica só com a primeira.
- Mesmo autor e ano em obras diferentes ainda não ganham "2026a" e "2026b".
- Editar a página de uma chamada pede apagar e inserir de novo.
