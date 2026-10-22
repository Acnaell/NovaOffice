# Changelog

Todas as mudanças relevantes da NovaOffice ficam registradas aqui.
O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

A seção da versão é usada como texto da página de release no GitHub.

## [Não lançado]

## [0.1.0] - 2026-10-21

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

[Não lançado]: https://github.com/Acnaell/novaoffice/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Acnaell/novaoffice/releases/tag/v0.1.0
