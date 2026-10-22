# ADR 0003: editor do app desktop

- Status: aceito
- Data: 2026-10-21

## Contexto

O núcleo já tem documento, formatação e desfazer. Falta uma tela onde se possa digitar. A proposta de
arquitetura prevê renderização própria em canvas (`nova-layout` + Skia), que ainda não existe, e o
editor precisa funcionar agora com acentos, IME, seleção com mouse e área de transferência.

## Decisão

1. Tauri 2: o núcleo Rust roda no mesmo processo do app (`src-tauri`), guardado num `Mutex<Editor>`,
   e é exposto por comandos (`dispatch`, `snapshot`, `open_document`, `save_document`, `export_markdown`).
2. A interface é React/TypeScript com um `contenteditable` usado só pelo que o navegador faz bem:
   cursor, seleção, IME, corretor ortográfico e cópia.
3. Toda alteração passa pelo núcleo: cada `beforeinput` é cancelado e traduzido em `TextCommand` por
   funções puras (`src/model.ts`); a resposta traz a visão do documento, e o DOM é recriado do zero
   (chave por revisão). Composição de IME é a exceção: o navegador escreve no DOM e o texto final vira
   comando em `compositionend`.
4. Comandos são enfileirados no front-end; cada um vê o estado deixado pelo anterior, então digitar
   rápido não troca a ordem das letras.
5. Seleções que atravessam parágrafos usam o novo comando `text.deleteRange`; ações que geram vários
   comandos (colar várias linhas, formatar vários parágrafos) usam `batch`, um passo de desfazer.

## Consequências

- O DOM nunca diverge do modelo por mais de um evento, e o mesmo caminho de comandos servirá para
  coedição e agentes de IA.
- Redesenhar o documento inteiro a cada tecla é simples, mas custa caro em documentos grandes; o
  `nova-layout` com renderização incremental substitui esta camada.
- Colar só aceita texto simples por enquanto.
