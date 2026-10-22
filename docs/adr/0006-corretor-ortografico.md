# ADR 0006: Corretor ortográfico com os dicionários do LibreOffice

- Status: aceito
- Data: 2026-10-22

## Contexto

O Nova Text usava o corretor do WebView (`spellcheck` no `contenteditable`). O resultado mudava
de sistema para sistema (WebView2, WebKit), o idioma não acompanhava a escolha do usuário, não
havia dicionário do usuário próprio e nada disso podia ser testado. O Word e o LibreOffice têm
corretor próprio, com sublinhado ondulado, sugestões no clique direito, Ignorar Tudo e Adicionar
ao Dicionário.

## Decisão

1. **Hunspell em Rust puro.** O crate `nova-spell` usa o `spellbook` (MPL-2.0), que lê dicionários
   Hunspell sem C nem FFI. Os dicionários são os do LibreOffice (VERO, SCOWL, RLA-ES), embutidos no
   binário; as licenças estão em `crates/nova-spell/DICIONARIOS.md`.
2. **O núcleo decide o que está errado; a interface decide o que sublinhar.** `spell_check` recebe
   os textos dos parágrafos e devolve intervalos UTF-16. A divisão em palavras segue o Word (ignora
   números, URLs, e-mails e MAIÚSCULAS) e fica no Rust, onde é testada.
3. **Só o parágrafo editado volta ao núcleo.** O resultado fica guardado por objeto de parágrafo,
   que o remendo do `dispatch` (ADR 0004) preserva quando o parágrafo não muda. A verificação
   espera 200 ms depois da última tecla; enquanto isso, o parágrafo editado mantém os sublinhados
   cujo texto não mudou, para não piscar.
4. **Sublinhado sem tocar no DOM do texto.** O sublinhado usa a CSS Custom Highlight API, como o
   destaque do Localizar: não cria `<span>`s nem muda offsets.
5. **Idioma de revisão na barra de status.** Sem escolha, segue o idioma da interface. O dicionário
   do usuário (`dicionario.json` na pasta de configuração do app) vale para todos os idiomas, como
   o `standard.dic` do LibreOffice.

## Consequências

- O executável fica cerca de 7 MB maior com os três dicionários.
- O corretor do WebView fica desligado; o comportamento é o mesmo em Windows, macOS e Linux, e os
  fluxos de `apps/desktop/e2e` cobrem o sublinhado, as sugestões e o dicionário do usuário.
- O idioma vale para o documento inteiro. Idioma por trecho (como `w:lang` no .docx) exige um
  atributo no modelo e fica para depois, assim como a verificação gramatical.
