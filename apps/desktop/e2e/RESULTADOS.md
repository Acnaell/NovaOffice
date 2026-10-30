# Fluxos do Word no Nova Text

Gerado por `npm run e2e` (apps/desktop/e2e). Cada fluxo dirige a interface real com o núcleo Rust real.

**132 funcionam · 2 parciais · 0 com falha · 3 ainda não existem**

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
| ✅ | Fonte | Pincel de Formatação (clique e arraste) | Barra de status: "+" |
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
| ✅ | Parágrafo | Sombreamento do parágrafo | Texto automático fica branco sobre fundo escuro, como no Word. |
| ✅ | Parágrafo | Mostrar Tudo ¶ (Ctrl+Shift+8) | Espaços (·), tabulações (→) e ¶ aparecem sem entrar no texto. |
| ✅ | Ferramentas | Localizar (Ctrl+L): painel, resultados e destaque | Enter vai para o próximo; Esc volta ao texto com a ocorrência selecionada. |
| ✅ | Ferramentas | Substituir e Substituir Tudo (Ctrl+U) | "Concluído. 2 substituições feitas."; Ctrl+Z desfaz o Substituir Tudo de uma vez. |
| ✅ | Ortografia | Sublinhar palavras erradas enquanto digita | Dicionários do LibreOffice (nova-spell); ignora siglas, URLs e números, como o Word. |
| ✅ | Ortografia | A palavra em digitação só é marcada ao sair dela |  |
| ✅ | Ortografia | Sugestões no clique direito | 6 sugestões, a melhor primeiro; Ctrl+Z desfaz a troca. |
| ✅ | Ortografia | Ignorar Tudo e Adicionar ao Dicionário | Todas as ocorrências deixam de ser marcadas; o dicionário do usuário vale para todos os idiomas. |
| ✅ | Ortografia | Idioma de revisão na barra de status | Português (VERO), inglês (SCOWL), espanhol (RLA-ES) ou desligado; a escolha fica salva. |
| ✅ | Ortografia | Idioma de revisão na aba Revisão (pt-BR, en-US, es-ES) | Revisão › Idioma; a barra de status acompanha a escolha. |
| ✅ | Ortografia | Ortografia e Gramática (F7): painel percorre os erros um a um | Alterar, Ignorar uma vez e Ignorar Tudo, do cursor em diante; termina com "A verificação ortográfica foi concluída". |
| ✅ | Ortografia | Ortografia e Gramática: Alterar Todas e a aba Revisão | Troca todas as ocorrências num único passo de desfazer; Esc fecha o painel. |
| ✅ | Ferramentas | AutoCorreção: aspas inteligentes, travessão e substituições | Aspas “ ”, -- vira — e a lista de substituições do Word ((c) → ©, ... → …). |
| ✅ | Ferramentas | Opções de AutoCorreção (Revisão › AutoCorreção) | Cada correção liga e desliga; a lista Substituir/Por é editável e fica salva. |
| ✅ | Ferramentas | Contar Palavras (Revisão, Ctrl+Shift+G): páginas, palavras, caracteres, parágrafos e linhas | 5 linhas medidas na tela; com seleção, conta só o trecho. Páginas estimadas pela altura (ainda sem paginação). |
| ✅ | Ferramentas | Contagem de palavras | Página 1 de 1 · Texto normal · 3 palavras · 2 parágrafos · Português (Brasil) · Inglês (EUA) · Espanhol (Espanha) · Não verificar ortografia · Alterações não salvas · − · 500% · 200% · 150% · 125% · 100% · 75% · 50% · 25% · Uma Página · Largura da Página · + |
| ✅ | Ferramentas | Contagem de palavras com 1 parágrafo (plural) |  |
| ✅ | Ferramentas | Autocorreção (maiúscula no início da frase) | Ao digitar o espaço depois da palavra, como no Word; Ctrl+Z logo depois desfaz só a correção. |
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
| ✅ | NovaOffice | Tela inicial ao abrir o programa | 8 aplicativos (com Nova Mail e Nova Drive), Novo e Recentes; título "NovaOffice". |
| ✅ | NovaOffice | Menu de aplicativos (grade ao lado do logo) | Nova Text, Nova Sheets, Nova Slides, Nova Draw, Nova Base, Nova Math, Nova Mail, Nova Drive; os outros 7 aparecem como "Em breve"; Esc fecha. |
| ✅ | Inserir | Quebra de Página (Ctrl+Enter) | Linha "Quebra de Página" na tela, página nova ao imprimir e no .docx/.odt; Backspace apaga a quebra. |
| ✅ | Inserir | Link no texto selecionado (Ctrl+K) e Ctrl+clique | "exemplo.com" vira https://exemplo.com; Ctrl+clique abre no navegador. |
| ✅ | Inserir | Link sem seleção, editar e remover |  |
| ✅ | Inserir | Endereço digitado vira link (AutoFormatação) |  |
| ✅ | Inserir | Data e Hora | 9 formatos; Alt+Shift+D insere a data. |
| ✅ | Inserir | Símbolo |  |
| ✅ | Inserir | Tabela: inserir pela grade, digitar e Tab entre células | Grade de 10×8 como no Word; aba Layout da Tabela aparece com o cursor na tabela. |
| ✅ | Inserir | Tabela: Tab na última célula cria linha; inserir e excluir linhas e colunas |  |
| ✅ | Inserir | Tabela: Backspace não junta células e .docx abre como tabela | Tabelas do Word e do LibreOffice validadas à parte (testes do núcleo). |
| ✅ | Inserir | Imagem do computador (Inserir → Imagens), tamanho e alinhamento | 64×32 px entra com 48×24 pt (96 ppp, como o Word); aba Formato da Imagem com tamanho e alinhamento. |
| ✅ | Inserir | Colar imagem (captura de tela) e mudar o tamanho com o mouse | A alça no canto mantém a proporção; Backspace apaga a imagem. |
| ✅ | Inserir | Imagem salva em .docx e reaberta | Imagens do Word e do LibreOffice validadas à parte (testes do núcleo). |
| ⬜ | Inserir | Comentários | Não há comentários. |
| ✅ | Referências | Sumário automático com páginas, atualizar e Ctrl+clique | Títulos 1 a 3 com pontilhado e páginas reais; Atualizar refaz; Ctrl+clique leva ao título; vai para .docx/.odt como campo TOC. |
| ✅ | Referências | Nota de rodapé (Ctrl+Alt+F): número no texto e nota no pé da página | Ctrl+Alt+F põe a chamada e o cursor na nota; Enter/Esc voltam ao texto; numeração automática; desfazer em dois passos (texto, nota). |
| ✅ | Referências | Notas de rodapé salvas no .docx e no .odt | word/footnotes.xml (w:footnoteReference) e text:note do .odt; validado no LibreOffice. |
| ✅ | Referências | Sumário salvo no .docx e no .odt | Campo TOC do Word (estilos Sumário 1…) e índice do LibreOffice (text:table-of-content); validado no LibreOffice. |
| ✅ | Exibição | Página com tamanho A4 e margens; várias páginas | 5 folhas A4 (21 × 29,7 cm); nenhum parágrafo atravessa a margem de baixo; "Página 1 de 5" na barra de status. |
| ⬜ | Exibição | Zoom (Ctrl + roda / controle de zoom) | Não há controle de zoom no app. |
| ✅ | Exibição | Tema claro/escuro | Recurso que o Word não tem nesta forma. |
| ⬜ | Exibição | Régua | Não há régua. |
| ✅ | Design | Cor da Página: cores do tema, Mais Cores e Sem Cor | Grade de Cores do Tema, Cores Padrão, Mais Cores… e Sem Cor, como no Word; Ctrl+Z desfaz. |
| ✅ | Design | Marca d'Água da galeria em todas as folhas, atrás do texto | Prata semitransparente na diagonal em 4 folhas, atrás do texto; Ctrl+Z / Ctrl+Y. |
| ✅ | Design | Marca d'Água Personalizada: texto, cor, transparência e horizontal; Remover | Caixa Marca d'Água como a do Word (Sem marca d'água / Marca d'água de texto, Aplicar). |
| ✅ | Design | Bordas da Página: caixa, sombra e dupla, com cor e largura | A 24 pt da beira do papel, como o padrão do Word; Nenhuma remove. |
| ✅ | Design | Imprimir/PDF com cor da página, borda e marca d'água | 3 páginas: cor no papel inteiro (print-color-adjust: exact), borda nas caixas de margem do @page e marca d'água semitransparente em cada página. |
| ✅ | Design | Cor, borda e marca d'água salvas no .docx e no .odt | w:background, w:pgBorders e v:textpath no cabeçalho (.docx); fo:background-color, fo:border e draw:custom-shape (.odt). Validado no LibreOffice (testes do núcleo). |
| ✅ | Layout | Margens prontas (Normal, ABNT…) e personalizadas | Inclui ABNT (3 cm em cima e à esquerda, 2 cm embaixo e à direita). |
| ✅ | Layout | Orientação paisagem e tamanho do papel | Ofício em paisagem; Ctrl+Z desfaz a mudança de página. |
| ✅ | Layout | Papel e margens salvos no .docx | w:pgSz e w:pgMar como no Word. |
| ✅ | Atualização | Aviso de versão nova ao abrir o app, com as Novidades | Faixa abaixo da faixa de opções; notas em Markdown numa caixa; links no navegador. |
| ✅ | Atualização | Mesma versão ou pré-lançamento: sem aviso | Consulta ao abrir; 0.1.6 e 0.3.0-beta.1 não aparecem. |
| ✅ | Atualização | Baixar e instalar (Windows): progresso, "Salvar alterações?" e instalador | Download com barra, pergunta antes de fechar e roda o instalador (/P no app). |
| ✅ | Atualização | Instalador que não confere (SHA-256) não é instalado |  |
| ✅ | Atualização | macOS e Linux: Baixar abre a página da release |  |
| ✅ | Atualização | Arquivo → Sobre: versão, Procurar atualizações e Avisar sobre atualizações | Preferência guardada em localStorage. |
| ✅ | Inserir | Cabeçalho e rodapé com número de página | Aba contextual, campos de página, duplo clique para editar; na impressão vai nas margens da página. |
| ✅ | Inserir | Cabeçalho e rodapé salvos no .docx | word/header1.xml e footer1.xml com o campo PAGE e "Primeira Página Diferente"; também em .odt. |
| ✅ | Exibir | Zoom na barra de status (−/+, porcentagem e Ctrl + roda) sem mudar as páginas | Páginas iguais em todos os níveis (Página 1 de 3); o zoom não fica salvo. |
| ✅ | Exibir | 100%, Uma Página e Largura da Página | Uma Página 54%, Largura da Página 157%. |
| ✅ | Exibir | Régua com as margens da página | Alinhada ao papel e à margem, em qualquer zoom; fica ligada ao reabrir. |
| ✅ | Exibir | Painel de Navegação: títulos e clique leva o cursor | Título 1 a 3, com a seção do cursor marcada. |
| ✅ | Exibir | Modo de Foco em tela inteira; Esc volta | Esconde a faixa de opções e a barra de status; o documento continua editável. |
| ✅ | Desempenho | Digitar num documento longo (≈300 parágrafos) | 11 ms por tecla. |
| 🟡 | Desempenho | Digitar num documento muito longo (≈2.000 parágrafos) | 51 ms por tecla: lento em documentos grandes (o DOM é recriado a cada tecla). |
