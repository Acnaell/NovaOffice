# Identidade visual da NovaOffice

Os arquivos ficam em [`assets/brand`](../assets/brand).

<p align="center"><img src="../assets/brand/novaoffice-banner.png" alt="NovaOffice" width="600"></p>

## Símbolo

Oito formas geométricas numa grade 4 × 2, uma para cada aplicativo da suíte, sobre o fundo azul-marinho.
O símbolo completo representa a NovaOffice; a versão em contorno com uma única forma colorida
representa cada aplicativo.

| Forma | Aplicativo | Equivalente | Cor |
| --- | --- | --- | --- |
| Duas barras | **Nova Text** | Writer | `#70B3F7` azul |
| Grade 2 × 2 | **Nova Sheets** | Calc | `#73C385` verde |
| Triângulo (play) | **Nova Slides** | Impress | `#ED946C` coral |
| Círculo | **Nova Draw** | Draw | `#D094DD` lilás |
| Quarto de círculo | **Nova Base** | Base | `#D1A84B` ouro |
| Sinal de mais | **Nova Math** | Math | `#2AC4CC` turquesa |
| Caixa de correio (com a bandeira levantada) | **Nova Mail** | E-mail (como o Thunderbird) | `#F07F9C` rosa |
| Nuvem em arcos (quarto de círculo + semicírculo sobre base reta) | **Nova Drive** | Arquivos na nuvem (motor Rclone) | `#9AA5F5` índigo |

Na grade, a primeira linha tem Text, Sheets, Slides e Mail; a segunda, Draw, Base, Math e Drive.

## Cores

| Uso | Hex |
| --- | --- |
| Fundo da marca | `#1D2D3D` |
| Contornos dos ícones de aplicativo | `#416180` |
| Texto claro sobre o fundo | `#F2F4F6` |
| Texto escuro sobre fundo claro | `#1D1F20` |

As oito cores dos aplicativos são usadas só para identificar o aplicativo correspondente,
nunca como cor decorativa genérica.

## Arquivos

| Arquivo | Uso |
| --- | --- |
| `novaoffice-icon.svg` | Símbolo em vetor; fonte de todos os ícones do app (`apps/desktop/app-icon.svg`) |
| `novaoffice-icon-{32,64,128,256}.png` | Símbolo em bitmap |
| `novaoffice-banner.png` | Logotipo horizontal (símbolo + "NovaOffice") para README e páginas |
| `social-preview.png` | Imagem de compartilhamento do repositório no GitHub (1280 × 640) |
| `products/card-<app>-light.png` | Card do aplicativo para fundo claro |
| `products/card-<app>-dark.png` | Card do aplicativo para fundo escuro |

## Regras de uso

- Mantenha o fundo `#1D2D3D` atrás do símbolo; não o coloque direto sobre fotos ou fundos coloridos.
- Não mude as cores, a ordem ou as proporções das formas.
- No logotipo, "Nova" vai em negrito e "Office" em peso regular, sem espaço entre as palavras.
- Os nomes dos aplicativos são sempre "Nova" + nome em inglês: Nova Text, Nova Sheets, Nova Slides,
  Nova Draw, Nova Base, Nova Math, Nova Mail, Nova Drive.

## Ícones do app desktop

Os ícones em `apps/desktop/src-tauri/icons` são gerados a partir do símbolo. Depois de alterar
`apps/desktop/app-icon.svg`, rode:

```powershell
cd apps/desktop
npx tauri icon app-icon.svg
```

e apague as pastas `icons/android` e `icons/ios` se não forem usadas.
