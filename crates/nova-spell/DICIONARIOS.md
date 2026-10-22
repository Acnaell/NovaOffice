# Dicionários do corretor

Os dicionários Hunspell em `dicionarios/` são os mesmos que o LibreOffice
distribui, copiados sem alteração do repositório
[LibreOffice/dictionaries](https://github.com/LibreOffice/dictionaries),
commit `67032ee957631908098a72edf48dc81cac27e369` (12/10/2026).

O código do `nova-spell` não modifica os arquivos; eles são embutidos no
binário (`include_str!`) e lidos pelo [`spellbook`](https://crates.io/crates/spellbook)
0.4 (MPL-2.0), uma implementação de Hunspell em Rust puro.

| Idioma | Arquivos | Origem | Licença | Escolha da NovaOffice |
|---|---|---|---|---|
| Português (Brasil) | `pt_BR.aff`, `pt_BR.dic` | VERO — Verificador Ortográfico do LibreOffice, de Raimundo Moura e equipe (`pt_BR/`) | LGPLv3 e MPL (dupla) | LGPLv3 |
| Inglês (EUA) | `en_US.aff`, `en_US.dic` | SCOWL, de Kevin Atkinson, versão 2020.12.07, com ajustes de Marco A. G. Pinto (`en/`) | Licença própria do SCOWL, permissiva no estilo BSD (inclui avisos de Ispell, WordNet, UKACD e outros) | — |
| Espanhol (Espanha) | `es_ES.aff`, `es_ES.dic` | RLA-ES — Recursos Lingüísticos Abiertos del Español (`es/`) | Tripla: GPLv3+, LGPLv3+ ou MPL 1.1+ | LGPLv3+ |

## Avisos e textos de licença

Ficam em `dicionarios/licencas/`, como exigem as licenças:

- `README_pt_BR.txt` — créditos e licença do VERO;
- `README_en_US.txt` — créditos e avisos de copyright do SCOWL (a licença
  pede que o aviso acompanhe todas as cópias);
- `README_hunspell_es.txt` e `LICENSE_es.md` — créditos e licença do RLA-ES;
- `LGPLv3.txt` e `MPL-1.1.txt` — textos completos das licenças escolhidas.

## O que as licenças significam para a NovaOffice

- **pt-BR e es (LGPLv3):** os dicionários são dados que o binário carrega;
  quem distribui a NovaOffice deve manter os avisos acima e oferecer os
  arquivos do dicionário (já estão no código-fonte) para que possam ser
  substituídos ou modificados. A LGPL não se estende ao resto do código.
- **en-US (SCOWL):** permite usar, copiar, modificar e vender, desde que o
  aviso de copyright acompanhe as cópias.

## Como atualizar

1. Baixe `pt_BR/pt_BR.{aff,dic}`, `en/en_US.{aff,dic}` e `es/es_ES.{aff,dic}`
   do repositório LibreOffice/dictionaries, junto com os READMEs.
2. Confira se a licença mudou e atualize esta tabela e o commit acima.
3. Rode `cargo test -p nova-spell`.
