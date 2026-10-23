# Nova Mail: visão do produto

> Status: ideia em discussão. Nada aqui está implementado ainda.

## Em uma frase

Uma caixa de entrada para todas as contas de e-mail da pessoa: Gmail, Outlook/Microsoft 365, iCloud,
Yahoo, provedores brasileiros (UOL, BOL, Terra) e qualquer servidor IMAP. Roda no computador, sem
servidor intermediário, e faz parte da NovaOffice.

## Para quem

- Quem tem duas ou mais contas (pessoal, trabalho, faculdade) e hoje alterna entre abas do navegador.
- Quem quer um cliente de e-mail livre e moderno no Windows, como alternativa ao Outlook e ao
  Thunderbird, e com a mesma cara do Nova Text.
- Estudantes e profissionais que mandam documentos: o anexo sai do Nova Text com um clique.

## Princípios

1. **Local primeiro.** As mensagens ficam no computador (banco local). A busca e a leitura funcionam
   sem internet. Nenhum servidor da NovaOffice vê os e-mails ou as senhas. Isso diferencia o Nova Mail
   de clientes "unificados" que sincronizam pela nuvem do fabricante.
2. **Conexão direta com cada provedor.** O app usa IMAP e SMTP padrão, com login OAuth2 onde o
   provedor exige (Google e Microsoft). Exchange e Microsoft Graph vêm depois.
3. **Configuração automática.** A pessoa digita e-mail e senha (ou clica em "Entrar com Google" ou
   "Entrar com Microsoft") e o resto se descobre sozinho.
4. **Segredos no cofre do sistema.** Senhas e tokens ficam no Gerenciador de Credenciais do Windows,
   no Keychain do macOS ou no Secret Service do Linux, nunca em arquivo.
5. **Mesmo jeito da suíte.** Faixa de opções, atalhos do Outlook, tema claro e escuro, português do
   Brasil como primeira língua.

## Primeira versão (MVP)

- Adicionar contas: Gmail e Outlook.com/Microsoft 365 com OAuth2; IMAP/SMTP com senha, configurados
  pelo banco de configurações (ver "O que aproveitar do Thunderbird").
- Caixa de Entrada Unificada, mais as pastas e marcadores de cada conta.
- Lista de mensagens com conversas agrupadas, não lidas, sinalizadas, anexos.
- Leitura segura: HTML sanitizado, imagens remotas bloqueadas por padrão e liberadas por remetente.
- Escrever, responder, responder a todos e encaminhar, usando o editor do Nova Text. Anexos e
  assinatura por conta.
- Busca local rápida (remetente, assunto, corpo) em todas as contas.
- Notificação de e-mail novo (IMAP IDLE).

## Depois

- Exchange (EWS) e Microsoft Graph, para contas corporativas que não liberam IMAP.
- Calendário e contatos (CalDAV/CardDAV, Google e Microsoft).
- Regras e filtros, respostas rápidas, enviar mais tarde, adiar mensagem.
- Criptografia: OpenPGP e S/MIME.
- Importar do Thunderbird e do Outlook (mbox e PST).

## Integração com a NovaOffice

- **Hub:** o Nova Mail aparece na tela inicial junto com os outros aplicativos.
- **Nova Text → e-mail:** Arquivo → Compartilhar → "Enviar por e-mail" anexa o documento aberto
  (.docx ou PDF).
- **E-mail → Nova Text:** anexos .docx, .odt e .md abrem direto no Nova Text.
- **Mesmo núcleo:** Rust + Tauri + React, como o Nova Text. O editor de mensagens reaproveita o
  modelo de documento (CRDT) e a formatação.

## O que aproveitar do Thunderbird

O Thunderbird roda sobre a plataforma do Firefox (Gecko, C++/JavaScript) e é licenciado sob MPL 2.0.
Não dá para embutir o Thunderbird no app Tauri, e uma versão com outro nome teria que tirar toda a
marca da Mozilla. Ele entra como referência e como fonte de peças:

- **ISPDB** (banco de configuração automática): servidores IMAP/SMTP dos provedores, consultado
  pelo domínio do e-mail. Também os mecanismos que o acompanham: `autoconfig.<domínio>`, registros
  MX e o Autodiscover da Microsoft.
- **Bibliotecas Rust do Thunderbird para Exchange (EWS).** Antes de usar, conferir a licença de cada
  crate.
- **Desenho de interface:** três painéis (pastas, lista e leitura), Caixa de Entrada Unificada e
  barra de busca rápida.

## Arquitetura proposta

```
crates/
  nova-mail-core      contas, sincronização, regras de negócio (sem interface)
    account           tipos de conta, configuração automática (ISPDB, autoconfig, MX)
    auth              OAuth2 (PKCE + navegador do sistema), cofre de senhas
    imap              sincronização: IDLE, CONDSTORE/QRESYNC, pastas, sinalizadores
    smtp              envio
    mime              leitura e montagem de mensagens, anexos, HTML seguro
    store             SQLite + FTS5 (cabeçalhos, corpos, índice de busca), cache em disco
apps/desktop          novo módulo "mail" no mesmo app Tauri do hub
```

- Bibliotecas candidatas (licença MIT/Apache a confirmar): `async-imap`, `lettre`, `mail-parser`,
  `mail-builder`, `oauth2`, `rusqlite`, `keyring`, `ammonia` (sanitizar HTML).
- A interface conversa com o núcleo pelos mesmos comandos Tauri, e os testes e2e usam a mesma
  ponte (`e2e/bridge`) com um servidor IMAP de teste local.

## Riscos e decisões em aberto

- **Gmail com OAuth2.** O escopo de e-mail do Google é restrito: um app com mais de 100 usuários
  precisa de verificação do Google, que inclui uma avaliação de segurança anual. Até lá, o app
  funciona com contas de teste ou com "senha de app" do Google.
- **Microsoft.** O login básico (senha) está desligado no Outlook.com e no Microsoft 365. É
  obrigatório registrar o app no Microsoft Entra e usar OAuth2 com IMAP/SMTP.
- **Um app só ou separado?** A proposta é um módulo dentro do app NovaOffice (hub), não um
  executável à parte. Fica para o ADR.
- **Identidade visual:** a forma escolhida é o **funil**, um trapézio que se estreita para a direita:
  várias contas convergindo numa caixa só. É a sétima forma da família. A cor ainda está em aberto;
  a proposta é rosa `#F07F9C`.

## Roteiro

1. ADR da arquitetura e escolha das bibliotecas (licenças conferidas).
2. Núcleo: contas, configuração automática e IMAP somente leitura, com testes contra servidor local.
3. Interface: três painéis e Caixa de Entrada Unificada (leitura).
4. Enviar e responder (SMTP, editor do Nova Text, anexos).
5. OAuth2 Google e Microsoft, cofre de senhas.
6. Busca, notificações e polimento. Primeira versão pública (beta).
