# Fluxos do Word no Nova Text

Gerado por `npm run e2e` (apps/desktop/e2e). Cada fluxo dirige a interface real com o núcleo Rust real.

**81 funcionam · 3 parciais · 0 com falha · 11 ainda não existem**

| | Área | Fluxo | Observação |
| --- | --- | --- | --- |
| ✅ | Digitação | Digitar texto com acentos e cedilha |  |
| ✅ | Digitação | Acento por tecla morta / IME (composição) | Composição gera o caractere final uma única vez. |
| ✅ | Digitação | Acento composto no meio de uma palavra existente (tecla morta) |  |
| ✅ | Digitação | Acento composto sobre uma seleção |  |
| ✅ | Digitação | Digitação rápida mantém a ordem das letras |  |
| ✅ | Digitação | Enter cria novo parágrafo |  |
| ✅ | Digitação | Enter no meio do parágrafo divide o texto |  |
| ✅ | Digitação | Shift+Enter: quebra de linha dentro do parágrafo | Mesmo caractere de quebra de linha do Word (U+000B). |
| ✅ | Digitação | Backspace e Delete |  |
| ✅ | Digitação | Backspace no início junta com o parágrafo anterior |  |
| ✅ | Digitação | Ctrl+Backspace / Ctrl+Delete apagam palavra | Como no Word: apaga a palavra e mantém os espaços em volta. |
| ✅ | Digitação | Emoji composto (família, bandeira) apaga inteiro |  |
| ✅ | Digitação | Tab insere tabulação | Insere \t; no início de um item de lista, muda o nível (como no Word). |
| ✅ | Navegação | Setas esquerda/direita e cima/baixo |  |
| ✅ | Navegação | Home / End |  |
| ✅ | Navegação | Ctrl+Home / Ctrl+End |  |
| ✅ | Navegação | Ctrl+setas pulam palavras |  |
| ✅ | Navegação | Ctrl+↑/↓ vão ao parágrafo anterior/seguinte |  |
| ✅ | Navegação | Page Up / Page Down | Desceu até o parágrafo 24. |
| ✅ | Seleção | Shift+setas e Shift+End selecionam |  |
| ✅ | Seleção | Ctrl+T seleciona tudo e Delete limpa o documento |  |
| ✅ | Seleção | Duplo clique seleciona palavra; triplo, o parágrafo |  |
| ✅ | Seleção | Selecionar com o mouse (arrastar) |  |
| ✅ | Seleção | Digitar sobre seleção que cruza parágrafos |  |
| ✅ | Área de transferência | Copiar e colar (Ctrl+C / Ctrl+V) |  |
| ✅ | Área de transferência | Recortar (Ctrl+X) |  |
| ✅ | Área de transferência | Copiar vários parágrafos e colar |  |
| ✅ | Área de transferência | Colar mantendo a formatação (negrito vindo de outro app) |  |
| ✅ | Área de transferência | Copiar daqui com formatação para outro app | Leva HTML limpo (Word, e-mail) e o formato próprio do Nova. |
| ✅ | Área de transferência | Colar ▾ Manter Somente Texto |  |
| ✅ | Área de transferência | Botões Recortar, Copiar e Colar da faixa |  |
| ✅ | Desfazer | Ctrl+Z / Ctrl+Y desfazem e refazem digitação | Depois de Ctrl+Z: ["primeira",""] |
| ✅ | Desfazer | Desfazer devolve o cursor ao lugar da edição |  |
| ✅ | Desfazer | Desfazer formatação e colagem |  |
| ✅ | Fonte | Negrito, itálico, sublinhado por atalho (Ctrl+N/I/S, Word em português) |  |
| ✅ | Fonte | Tachado (botão) | Atalho Alt+Shift+5 (não existe no Word por padrão). |
| ✅ | Fonte | Negrito sem seleção vale para o que for digitado |  |
| ✅ | Fonte | Negrito no cursor dentro de uma palavra aplica à palavra inteira |  |
| ✅ | Fonte | Botões indicam a formatação sob o cursor |  |
| ✅ | Fonte | Escolher fonte (família) na lista |  |
| ✅ | Fonte | Digitar o nome da fonte e Enter | O foco volta ao documento. |
| ✅ | Fonte | Tamanho da fonte: lista, digitar e Ctrl+Shift+> / < | 14 → 16 → 14 → 12, a lista do Word. |
| ✅ | Fonte | Cor da fonte (paleta e botão repete a última cor) |  |
| ✅ | Fonte | Realce (marca-texto) e Sem Cor |  |
| ✅ | Fonte | Subscrito / sobrescrito (Ctrl+= / Ctrl+Shift+=) | Repetir o atalho desliga. |
| ✅ | Fonte | Limpar formatação (Ctrl+Espaço e botão) |  |
| ✅ | Fonte | Maiúsculas e minúsculas (Shift+F3 e menu Aa) |  |
| ✅ | Fonte | Pincel de Formatação (clique e arraste) | Barra de status: "Pincel de Formatação: selecione o texto que vai receber a formatação (Esc cancela)" |
| ✅ | Fonte | Copiar/colar formatação (Ctrl+Shift+C / Ctrl+Shift+V) |  |
| ✅ | Parágrafo | Estilos de título por atalho (Ctrl+Alt+1) |  |
| ✅ | Parágrafo | Estilos pela galeria da faixa de opções |  |
| ✅ | Parágrafo | Enter no fim de um título volta ao texto normal |  |
| ✅ | Parágrafo | Alinhamento (Ctrl+Q / E / G / J, Word em português) |  |
| ✅ | Parágrafo | Lista com marcadores (botão e Ctrl+Shift+L) | O atalho desliga de novo. |
| ✅ | Parágrafo | Lista numerada: Enter continua, Enter no item vazio sai |  |
| ✅ | Parágrafo | Tab / Shift+Tab mudam o nível do item |  |
| ✅ | Parágrafo | Backspace no início do item tira o marcador |  |
| ✅ | Parágrafo | Lista automática ao digitar "- " ou "1. " |  |
| ✅ | Parágrafo | Aumentar/diminuir recuo (Ctrl+M / Ctrl+Shift+M) | 2 níveis = 96px |
| ✅ | Parágrafo | Espaçamento entre linhas (Ctrl+1/2/5 e menu) e antes/depois |  |
| ⬜ | Parágrafo | Quebra de página (Ctrl+Enter) | Fica para a fase Layout (páginas reais); Ctrl+Enter resulta em ["antesdepois"]. |
| ✅ | Parágrafo | Mostrar Tudo ¶ (Ctrl+Shift+8) | Espaços (·), tabulações (→) e ¶ aparecem sem entrar no texto. |
| ⬜ | Inserir | Tabela | Não há tabelas (roadmap). |
| ⬜ | Inserir | Imagem | Não há imagens (roadmap); colar uma imagem é ignorado sem erro. |
| ⬜ | Inserir | Hiperlink (Ctrl+K) | Hiperlink não existe; Control+k não altera o documento. |
| ⬜ | Inserir | Links digitados viram clicáveis | Endereços como https://… ficam como texto comum. |
| ⬜ | Inserir | Símbolos e caracteres especiais | Não há janela de símbolos (dá para colar ou usar o teclado do sistema). |
| ⬜ | Inserir | Cabeçalho, rodapé e número de página | Não há cabeçalho/rodapé nem paginação. |
| ⬜ | Inserir | Comentários | Não há comentários. |
| ✅ | Ferramentas | Localizar (Ctrl+L): painel, resultados e destaque | Enter vai para o próximo; Esc volta ao texto com a ocorrência selecionada. |
| ✅ | Ferramentas | Substituir e Substituir Tudo (Ctrl+U) | "Concluído. 2 substituições feitas."; Ctrl+Z desfaz o Substituir Tudo de uma vez. |
| 🟡 | Ferramentas | Verificação ortográfica | Usa o corretor do sistema/WebView (sublinhado vermelho); o idioma não acompanha o documento e não há verificação gramatical. Precisa ser confirmado no app instalado (WebView2/WebKit). |
| ✅ | Ferramentas | Contagem de palavras | Texto normal · 3 palavras · 2 parágrafos · Alterações não salvas |
| ✅ | Ferramentas | Contagem de palavras com 1 parágrafo (plural) |  |
| ⬜ | Ferramentas | Autocorreção (maiúscula no início da frase) | Não há autocorreção (maiúscula inicial, aspas inteligentes, -- → —). |
| ✅ | Arquivo | Salvar (.docx padrão), fechar e reabrir preserva texto e formatação | Sugere "Sem título.docx" com "Documento do Word (*.docx)" primeiro; título da janela: "ciclo.docx — Nova Text" |
| ✅ | Arquivo | Salvar como em cada formato (tela Arquivo) | odt:ok · nova:ok · md:ok · txt:ok · html:ok · docx:ok |
| ✅ | Arquivo | Ctrl+B num documento novo pede onde salvar |  |
| ✅ | Arquivo | Novo documento com alterações pergunta Salvar / Não Salvar / Cancelar |  |
| ✅ | Arquivo | Fechar a janela com alterações não salvas | Cancelar mantém a janela; Salvar grava e fecha. |
| ✅ | Arquivo | Abrir arquivo .docx do Word | Filtro: "Todos os documentos (*.docx;*.odt;*.nova;*.md;*.txt)". Arquivos do Word e do LibreOffice validados à parte (testes do núcleo). |
| ✅ | Arquivo | Abrir .txt / .md | Markdown vira títulos, negrito e listas. |
| ✅ | Arquivo | Documentos recentes | 11 na lista; um clique reabre. |
| ✅ | Arquivo | Exportar uma cópia (.html) sem mudar o arquivo atual |  |
| 🟡 | Arquivo | Exportar para PDF | Pela janela de impressão do sistema ("Salvar como PDF"); ainda sem exportação direta para .pdf. |
| ✅ | Arquivo | Imprimir (Ctrl+P) | Tela Imprimir → janela de impressão do sistema; só a página sai no papel. |
| ✅ | Arquivo | Salvamento automático / recuperação | Cópia a cada minuto; ao abrir de novo, a tela inicial oferece Recuperar. |
| ✅ | NovaOffice | Tela inicial ao abrir o programa | 6 aplicativos, Novo e Recentes; título "NovaOffice". |
| ✅ | NovaOffice | Menu de aplicativos (grade ao lado do logo) | Nova Text, Nova Sheets, Nova Slides, Nova Draw, Nova Base, Nova Math; os outros 5 aparecem como "Em breve"; Esc fecha. |
| 🟡 | Exibição | Página com tamanho A4 e margens; várias páginas | Uma única "folha" contínua de 4108 px de altura: sem paginação, tamanho de papel ou margens configuráveis. |
| ⬜ | Exibição | Zoom (Ctrl + roda / controle de zoom) | Não há controle de zoom no app. |
| ✅ | Exibição | Tema claro/escuro | Recurso que o Word não tem nesta forma. |
| ⬜ | Exibição | Régua | Não há régua. |
| ✅ | Desempenho | Digitar num documento longo (≈300 parágrafos) | 8 ms por tecla. |
| ✅ | Desempenho | Digitar num documento muito longo (≈2.000 parágrafos) | 13 ms por tecla. |
