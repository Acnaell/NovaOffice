# ADR 0002: formatação, estilos de parágrafo e desfazer

- Status: aceito
- Data: 2026-10-20

## Contexto

O incremento 1 guardava cada parágrafo como um `YText` simples, sem lugar para estilo de parágrafo,
e não tinha desfazer. Formatação e desfazer precisam funcionar com coedição: duas pessoas formatando
o mesmo trecho devem convergir, e cada uma deve desfazer só as próprias edições.

## Decisão

1. Cada parágrafo é um `YMap` com `style` (texto) e `text` (`YText`). O estilo fica no mapa porque
   é do parágrafo inteiro; a formatação de caractere fica nos atributos do `YText`, o mesmo modelo
   do Yjs/Quill, o que mantém compatibilidade com editores web que usam Yjs.
2. Marcas de caractere são um enum fechado no domínio (`Mark`), gravadas com chaves estáveis
   (`bold`, `fontSize`…). Tamanho em meios-pontos, como o `w:sz` do OOXML. Atributos desconhecidos
   são ignorados na leitura, para abrir documentos de versões futuras ou de plugins.
3. O desfazer usa o `UndoManager` do Yrs com escopo no array de blocos. Atualizações remotas são
   aplicadas com a origem `remote`, que o desfazer não rastreia.
4. Digitação e exclusão se agrupam pela janela de 500 ms do Yrs; os demais comandos fecham o grupo
   antes e depois, virando um passo próprio.
5. Dividir e juntar parágrafos copiam os trechos com seus atributos, então a formatação sobrevive.
6. O formato `.nova` passa para a versão 2; a versão 1 deixa de ser lida (não havia usuários).

## Consequências

- O histórico de desfazer vive na memória da sessão; persistir histórico entre sessões fica para depois.
- Montar o documento inicial (`new`, `from_plain_text`) limpa o histórico, para o usuário não
  desfazer o próprio documento até ficar sem parágrafos.
- Exportar para Markdown perde fonte, tamanho e cor, que o Markdown não representa.
