# ADR 0001: núcleo em Rust com documento em CRDT

- Status: aceito
- Data: 2026-10-20

## Contexto

No LibreOffice, o modelo de documento depende da UI (`sw`, `sc` e `sd` ligam `vcl` diretamente),
filtros escrevem pelo API UNO e a coedição chega como enxerto (Yrs experimental em `sw`).
A NovaOffice precisa rodar o mesmo modelo no desktop, no navegador e no servidor, com coedição
desde o início.

## Decisão

1. O núcleo (domínio, motores, aplicação) é Rust, sem dependência de UI, e compila para nativo e WASM.
2. O estado de cada documento é um CRDT Yrs. O resto do núcleo usa só a fachada `nova-crdt`.
3. Toda mudança entra como comando (`TextCommand`) e sai como evento de domínio (`TextEvent`),
   pela `Session` em `nova-app`. UI, plugins, IA e CLI usam o mesmo caminho.
4. Offsets de texto são unidades UTF-16, para coincidir com o JavaScript do front-end.
5. Arquivos `.nova` guardam o estado CRDT com um cabeçalho versionado; formatos de troca
   (ODT, DOCX) virão como plugins.

## Consequências

- Coedição, fusão de cópias offline e histórico usam o mesmo mecanismo.
- Só a réplica que cria o documento insere o primeiro bloco; as outras carregam o estado dela.
- Operações estruturais (dividir parágrafo) são composições de operações do CRDT e precisam de
  testes de convergência específicos.
- A troca do Yrs por outro CRDT fica restrita ao crate `nova-crdt`.
