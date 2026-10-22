# ADR 0005: Aba Arquivo, formatos de arquivo e o NovaOffice como concentrador dos aplicativos

- Status: aceito
- Data: 2026-10-22

## Contexto

O Nova Text só abria e salvava `.nova` (mais `.txt`/`.md` como texto puro) e exportava Markdown. Quem
vem do Word ou do LibreOffice precisa trocar arquivos `.docx` e `.odt` sem pensar, e espera a tela
Arquivo do Word: Novo, Abrir com recentes, Salvar como com o tipo de arquivo, Imprimir, Exportar. Além
disso, o NovaOffice é uma suíte: o programa instalado deve ser a porta de entrada dos aplicativos, não
só o editor de texto.

## Decisão

1. **.docx é o formato padrão.** Salvar um documento novo sugere `<título>.docx`, com "Documento do
   Word (*.docx)" como primeiro filtro. O formato de cada gravação vem da extensão do caminho; sem
   extensão, vira `.docx`. Os formatos ficam em `nova_app::formats` (`Format::ALL`, na ordem da tela
   Salvar como: docx, odt, nova, md, txt, html).
2. **Leitores e gravadores próprios, sem LibreOffice.** DOCX e ODT são escritos com `zip` e `quick-xml`,
   na ordem de elementos exigida pelos esquemas (OOXML estrito; no ODT, `mimetype` primeiro e sem
   compressão). Cada formato vai e volta pelo modelo `Paragraph { style, attrs, spans }`. A leitura é
   tolerante: estilos por id ou nome (inclusive os ids em português do Word), numeração herdada do
   estilo, `w:position` do LibreOffice como sobrescrito/subscrito. Validado contra o LibreOffice 24.2
   nos dois sentidos.
3. **O histórico de coedição só existe no `.nova`.** Os outros formatos guardam o conteúdo; ao abrir,
   o documento começa um histórico novo. A tela Salvar como diz isso em "Documento NovaOffice".
4. **Comandos do app fora do Tauri.** `src-tauri/src/app.rs` (`App`) concentra os comandos e é usado
   tanto pela janela (`lib.rs`) quanto pela ponte de testes, que agora testa abrir/salvar de verdade.
   `store.rs` guarda recentes (25, só os que ainda existem) e a cópia de recuperação, com gravação
   atômica (temporário + renomear) na pasta de dados do app.
5. **Recuperação automática.** A interface pede `autosave` a cada minuto; com alterações não salvas, o
   núcleo grava uma cópia `.nova`; sem alterações, descarta. Salvar, abrir ou criar documento também
   descarta. Na abertura seguinte, a tela inicial oferece Recuperar ou Descartar.
6. **Perguntar antes de perder trabalho.** Novo, Abrir, Fechar e o X da janela mostram "Deseja salvar
   as alterações?" com Salvar, Não Salvar e Cancelar (caixa da própria interface, no lugar do `ask` do
   sistema, para ter os três botões). O X usa `onCloseRequested` + `destroy()`.
7. **Imprimir e PDF pela janela do sistema.** `window.print()` com CSS de impressão que mostra só a
   página; o PDF sai pela impressora "Salvar como PDF". Uma exportação direta virá com a paginação
   (`nova-layout`).
8. **NovaOffice como concentrador.** A tela Arquivo é também a tela inicial do programa (quando ele abre
   sem documento): aplicativos, documento em branco, recentes e recuperação. O botão de grade ao lado
   do logo abre o menu "Aplicativos" com os seis da suíte; o atual fica destacado e os que ainda não
   existem aparecem como "Em breve".

## Consequências

- Arquivos `.docx`/`.odt` abrem e salvam sem conversor externo, também no CLI e nos testes.
- Recursos do Word que o modelo ainda não tem (tabelas, imagens, cabeçalhos, comentários) são
  ignorados na leitura; quando o modelo ganhar esses blocos, os leitores ganham os elementos.
- Os aplicativos futuros entram em `APPS` (AppLauncher.tsx) trocando `ready` para `true`.
