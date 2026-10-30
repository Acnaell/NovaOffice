# Changelog

Todas as mudanças relevantes da NovaOffice ficam registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

A seção da versão é usada como texto da página de release no GitHub.

## [Não lançado]

### Adicionado

- **Atualização assinada**: cada release publica um `latest.json` com a assinatura de cada
  instalador, e o app só instala o que foi assinado com a chave da NovaOffice. O app baixa a versão
  nova, confere a assinatura, instala e reinicia sozinho no Windows, no macOS e no AppImage do
  Linux (.deb e .rpm seguem pelo sistema). Vale a partir da próxima versão; até lá, o aviso usa o
  instalador conferido pelo `.sha256`, como antes.

## [0.1.13] - 2026-10-30

### Adicionado

- **Comentários** (Revisão → Novo Comentário, Ctrl+Alt+M): o trecho selecionado (ou a palavra do
  cursor) fica destacado e o balão aparece na margem direita, com autor, data e iniciais. Dá para
  responder, editar (clique duplo), resolver, reabrir e excluir; Anterior e Próximo andam pelos
  comentários e Mostrar Comentários esconde a coluna. Lidos e gravados em .docx (`comments.xml` e
  `commentsExtended.xml`) e .odt (`office:annotation`), com respostas e resolvido, validados no
  LibreOffice nos dois sentidos.
- **Exportar para PDF direto** (Arquivo → Exportar → Criar PDF): escolhe onde salvar e grava o
  .pdf sem passar pela janela de impressão, com o papel, as margens, o cabeçalho, o rodapé, as notas
  e a marca d'água do documento. No Windows usa o `PrintToPdf` do WebView2; no Linux, o WebKitGTK.
  No macOS (e num WebView2 antigo), continua abrindo a impressão ("Salvar como PDF").

### Corrigido

- No .odt com cabeçalho ou rodapé, o texto começa na margem certa no LibreOffice (antes o cabeçalho
  ficava dentro da margem e empurrava o texto para baixo, e a margem crescia ao converter para .docx).

## [0.1.12] - 2026-10-30

### Adicionado

- Aba **Design** no Nova Text, entre Inserir e Layout, como no Word: **Cor da Página** (cores do
  tema, Mais Cores e Sem Cor), **Marca d'Água** (CONFIDENCIAL, NÃO COPIE e RASCUNHO na diagonal ou
  na horizontal, ou um texto seu, com cor e transparência) e **Bordas da Página** (caixa, sombra ou
  dupla, com cor e largura). Aparecem nas folhas, saem na impressão e no PDF e vão para o .docx e o
  .odt, abrindo no Word e no LibreOffice.

### Corrigido

- Papel e margens de um .odt gravado pelo LibreOffice agora são lidos (antes valia o padrão).

## [0.1.11] - 2026-10-30

### Adicionado

- Aba Exibir como a do Word: zoom de 10% a 500% (− e + na barra de status, porcentagem com as
  opções prontas, Ctrl + roda do mouse, 100%, Uma Página e Largura da Página) sem mudar a
  paginação; régua horizontal com as margens da página; Painel de Navegação com os títulos
  (Título 1 a 3), que leva o cursor ao título clicado; e Modo de Foco em tela inteira, só com o
  documento (Esc volta).
- **Notas de rodapé** (Referências → Inserir Nota de Rodapé, Ctrl+Alt+F): número sobrescrito no
  texto, numeração automática pela ordem e as notas no pé da página onde a chamada cai, editáveis
  ali mesmo (Enter ou Esc voltam ao texto). Próxima Nota de Rodapé leva o cursor à chamada seguinte.
  São lidas e gravadas em .docx (`footnotes.xml`) e .odt (`text:note`), validadas no LibreOffice.
  Em Markdown viram `[^1]`; em HTML e texto, uma lista de notas no fim. Na impressão pelo navegador,
  as notas saem no fim do documento.

## [0.1.10] - 2026-10-24

### Alterado

- O símbolo do **Nova Mail** agora é uma **caixa de correio** com a bandeira levantada. Ela
  substitui o funil, que nos ícones pequenos ficava parecido com o triângulo do Nova Slides.

## [0.1.9] - 2026-10-23

### Alterado

- Novo símbolo da NovaOffice com **8 aplicativos** numa grade 4 × 2. Entram o **Nova Mail** (funil
  rosa) e o **Nova Drive** (nuvem em arcos índigo), ainda como "Em breve". Mudam o ícone do app,
  os cards, o logotipo e a imagem de compartilhamento. A tela inicial e o menu de aplicativos
  mostram os 8 em duas linhas de 4.

## [0.1.8] - 2026-10-23

### Adicionado

- **Cabeçalho, rodapé e número de página** (Inserir → Cabeçalho e Rodapé): duplo clique na margem
  de cima ou de baixo para editar, aba contextual com Número de Página e Número de Páginas,
  Primeira Página Diferente e alinhamento. Número de Página tem as posições do Word (início ou fim da
  página, à esquerda, no centro ou à direita, e "Página X de Y"). Na impressão e no PDF vão nas
  margens de cada página. São lidos e gravados em .docx (`header1.xml`/`footer1.xml` com os campos
  PAGE e NUMPAGES) e .odt.
- Aba **Referências** com **Sumário Automático**: lista os títulos 1 a 3 com pontilhado e o número
  da página real de cada um; Atualizar Sumário refaz a lista; Ctrl+clique numa entrada leva ao
  título. Vai para o .docx como campo TOC do Word e para o .odt como índice do LibreOffice, e volta.

## [0.1.7] - 2026-10-23

### Adicionado

- Corretor ortográfico no Nova Text, com os dicionários do LibreOffice (português do Brasil, inglês
  e espanhol): sublinhado vermelho enquanto digita, sugestões no clique direito, Ignorar Tudo e
  Adicionar ao Dicionário. O idioma de revisão fica na barra de status.
- Aba Revisão no Nova Text: idioma de revisão (português do Brasil, inglês dos EUA, espanhol da
  Espanha), Ortografia e Gramática (F7) com painel que percorre os erros um a um, AutoCorreção
  enquanto digita (maiúscula no início da frase, aspas inteligentes, -- vira —, lista de
  substituições editável) e Contar Palavras (Ctrl+Shift+G) com páginas, palavras, caracteres,
  parágrafos e linhas.
- Aviso de atualização: ao abrir o app (e uma vez por dia), a NovaOffice procura uma versão nova no
  GitHub e mostra uma faixa abaixo da faixa de opções, com as Novidades da versão. No Windows,
  "Baixar e instalar" baixa o instalador, confere o SHA-256, pergunta se salva o documento e instala;
  no macOS e no Linux, abre a página da release. Arquivo → Sobre mostra a versão, procura
  atualizações e liga ou desliga o aviso.

## [0.1.6] - 2026-10-22

### Adicionado

- **Páginas na tela**: o documento aparece em folhas separadas do tamanho do papel. Um parágrafo ou
  uma tabela que não cabe no fim de uma página passa para a seguinte, e a quebra de página começa uma
  folha nova. A barra de status mostra "Página X de Y".
- Aba **Layout**:
  - **Margens**: Normal, ABNT (3 cm em cima e à esquerda, 2 cm embaixo e à direita), Estreita,
    Moderada, Larga e Margens Personalizadas, em centímetros;
  - **Orientação**: retrato ou paisagem;
  - **Tamanho**: A4, Carta, Ofício, A5 e A3.

  Tudo isso entra no desfazer.
- Papel e margens são lidos e gravados em .docx (`w:pgSz`/`w:pgMar`) e .odt (`style:page-layout`) e
  valem para Imprimir e para o PDF.

### Alterado

- A marca "Quebra de Página" só aparece com Mostrar Tudo (¶), como no Word, porque a quebra agora começa
  uma folha nova.

## [0.1.5] - 2026-10-22

### Adicionado

- **Imagens** (Inserir → Imagens): PNG, JPEG, GIF, BMP e WebP do computador, ou coladas da área de
  transferência (capturas de tela, imagens copiadas do navegador). Entram com o tamanho do Word (96
  ppp), no máximo da largura do texto.
- Aba contextual **Formato da Imagem**: largura de 25%, 50%, 75% ou 100% da largura do texto,
  alinhamento e Excluir Imagem. A alça no canto muda o tamanho com o mouse, mantendo a proporção.
  Backspace no início da imagem (ou Delete antes dela) apaga a imagem.
- Imagens ficam dentro do documento (também no .nova e na colaboração) e são lidas e gravadas em
  .docx, .odt, .html e Markdown (embutidas como data URL).

## [0.1.4] - 2026-10-22

### Adicionado

- **Tabelas** (Inserir → Tabela):
  - grade de 10×8 para escolher o tamanho, como no Word;
  - Tab e Shift+Tab andam entre as células, e Tab na última célula cria uma linha;
  - Enter cria outro parágrafo na mesma célula;
  - aba contextual **Layout da Tabela** com Inserir Acima, Abaixo, à Esquerda e à Direita, e
    Excluir Linhas, Colunas e Tabela;
  - Backspace e Delete não juntam células, e apagar uma seleção que atravessa células apaga só o texto;
  - copiar e colar tabelas; colar dentro de uma célula põe o texto na célula.
- Tabelas são lidas e gravadas em .docx (bordas da Grade da Tabela, sombreamento de célula, células
  mescladas na horizontal lidas como célula única), .odt, .html e Markdown (tabelas do GitHub).

## [0.1.3] - 2026-10-22

### Adicionado

- Aba **Inserir**, primeira parte:
  - **Quebra de Página** (Ctrl+Enter), mostrada como uma linha no texto e respeitada ao imprimir; o
    Backspace no início do parágrafo apaga a quebra.
  - **Link** (Ctrl+K) no texto selecionado ou com texto novo, editar e remover; "exemplo.com" vira
    `https://exemplo.com` e um e-mail vira `mailto:`. Ctrl+clique abre no navegador.
  - Endereços da Web e e-mails digitados viram links ao digitar espaço ou Enter (AutoFormatação).
  - **Data e Hora** com os formatos do idioma; Alt+Shift+D e Alt+Shift+T inserem data e hora.
  - **Símbolo**: grade com os símbolos mais usados (©, ®, ™, §, °, ±, €, setas, letras gregas…).
- Links e quebras de página são lidos e gravados em .docx, .odt, .html e Markdown (`[texto](endereço)`);
  links copiados vão para outros programas como links.

### Corrigido

- Markdown: negrito no fim do parágrafo (`texto **negrito**`) deixava um `*` sobrando.
- .docx: quebra de página no fim de um parágrafo criava um parágrafo vazio a mais.

## [0.1.2] - 2026-10-22

### Adicionado

- Sombreamento de parágrafo (Página Inicial → Parágrafo), lido e gravado em .docx, .odt e .html. Como
  no Word, o texto em cor automática fica branco sobre fundo escuro.

### Corrigido

- Arquivos .docx abrem com a formatação que vem dos estilos do Word: fonte e tamanho padrão do
  documento (inclusive as fontes do tema), estilos de parágrafo como "Normal (Web)", estilos de
  caractere como "Forte" e espaçamento automático. Células de tabela sombreadas mantêm a cor de fundo.

## [0.1.1] - 2026-10-22

### Adicionado

- Formatos de arquivo: abrir e salvar Documento do Word (.docx, o padrão), Texto OpenDocument (.odt),
  Documento NovaOffice (.nova), Markdown (.md, com títulos, negrito, itálico e listas) e texto sem
  formatação (.txt); exportar como Página da Web (.html).
- Tela Arquivo como a do Word: Início, Novo, Abrir (com Recentes e Procurar), Salvar, Salvar como (com
  o tipo de arquivo), Imprimir, Exportar (PDF e outros formatos) e Fechar.
- Tela inicial do NovaOffice ao abrir o programa, com os aplicativos da suíte, documento em branco e recentes.
- Menu de aplicativos (botão de grade ao lado do logo) com Nova Text, Sheets, Slides, Draw, Base e
  Math; os que ainda não existem aparecem como "Em breve".
- "Deseja salvar as alterações?" com Salvar, Não Salvar e Cancelar ao criar, abrir ou fechar documento
  e ao fechar a janela.
- Recuperação automática: cópia do documento não salvo a cada minuto, oferecida na próxima abertura.
- Imprimir (Ctrl+P) e PDF pela janela de impressão do sistema; só a página é impressa.
- Lista de documentos recentes.
- O nome da janela mostra o formato do arquivo (por exemplo, `Carta.docx — Nova Text`).

### Removido

- Botão "Exportar para Markdown" da aba Arquivo (agora em Exportar e em Salvar como).

## [0.1.0] - 2026-10-22

Primeira versão pública da NovaOffice: o app desktop com o editor Nova Text e o CLI `nova`.

### Desempenho

- Cada tecla devolve e redesenha só os parágrafos alterados: num documento de 2.000 parágrafos, de
  ~140 ms para ~20 ms por tecla.

### Corrigido

- Acentos digitados com tecla morta (´ + a no teclado ABNT2) e IME eram descartados.
- Backspace e Delete apagam emojis compostos (família, bandeira) inteiros.

### Adicionado

- App desktop (Tauri 2 + React) com editor de texto: digitação com acentos e IME, Enter, Backspace,
  Delete e exclusão por palavra, colar texto com várias linhas, negrito, itálico, sublinhado,
  tachado, estilos de parágrafo, desfazer e refazer, abrir, salvar e exportar para Markdown.
- Identidade visual: símbolo, ícones do app, logotipo e cards dos aplicativos da suíte.
- CLI `nova` com os comandos `new`, `import`, `export` (texto ou Markdown), `exec` e `merge`.
- Documentos `.nova` (formato versão 2) baseados em CRDT (Yrs), com fusão de cópias editadas em separado.
- Formatação de caracteres: negrito, itálico, sublinhado, tachado, fonte, tamanho e cor.
- Estilos de parágrafo: títulos 1 a 6, citação e código.
- Desfazer e refazer por usuário dentro da sessão.
- Comando `text.deleteRange`, que apaga seleções que atravessam parágrafos.
- Comando `batch`, que aplica vários comandos como um único passo de desfazer.
- Faixa de opções no Nova Text: barra de título com a marca e acesso rápido (salvar, desfazer,
  refazer), abas Arquivo, Página inicial e Exibir, grupos rotulados e galeria de estilos; pode ser recolhida.
- Ícones da interface no traço da marca e ícone do app redesenhado a partir do símbolo NovaOffice.
- Tema claro, escuro ou do sistema (aba Exibir), com a paleta da marca; a escolha fica salva.
- Interface em português e inglês, com troca de idioma na aba Exibir.
- Tabela única de atalhos de teclado (`src/shortcuts.ts`), usada pelo teclado e pelas dicas dos botões.
- Página Inicial no modelo do Word: Área de Transferência (colar mantendo a formatação ou só o texto,
  recortar, copiar, Pincel de Formatação), Fonte (fonte, tamanho, A+/A-, maiúsculas e minúsculas,
  limpar formatação, subscrito, sobrescrito, realce, cor), Parágrafo (marcadores, numeração por nível,
  recuo, alinhamentos, entrelinhas, espaço antes/depois, Mostrar Tudo ¶) e Editando (painel de
  Navegação com Localizar, Substituir e Substituir Tudo).
- Atalhos do Word em português (Ctrl+N negrito, Ctrl+S sublinhado, Ctrl+B salvar, Ctrl+T selecionar
  tudo…) ou em inglês, conforme o idioma da interface.
- Copiar leva a formatação para o Word, navegador e e-mail; colar de lá traz negrito, cores,
  tamanhos, títulos, listas e alinhamento.
- Quebra de linha manual (Shift+Enter), Ctrl+↑/↓ entre parágrafos e clique triplo seleciona o parágrafo.
- Bateria de fluxos do Word (e2e) rodando a interface real no CI.
- Instaladores para Windows (`.exe` e `.msi`), macOS (`.dmg`, Intel e Apple Silicon) e Linux
  (`.AppImage`, `.deb` e `.rpm`), e o CLI para Windows, macOS e Linux (x86_64 e ARM64).

[Não lançado]: https://github.com/Acnaell/novaoffice/compare/v0.1.13...HEAD
[0.1.13]: https://github.com/Acnaell/novaoffice/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/Acnaell/novaoffice/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Acnaell/novaoffice/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/Acnaell/novaoffice/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Acnaell/novaoffice/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Acnaell/novaoffice/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Acnaell/novaoffice/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Acnaell/novaoffice/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Acnaell/novaoffice/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Acnaell/novaoffice/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Acnaell/novaoffice/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Acnaell/novaoffice/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Acnaell/novaoffice/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Acnaell/novaoffice/releases/tag/v0.1.0
