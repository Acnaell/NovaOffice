// Ícones da interface, desenhados no traço geométrico da marca NovaOffice:
// linhas de 1,75 px em grade de 20 px, cantos arredondados, cor do texto.

import type { ReactNode, SVGProps } from "react";

/** Cores da marca, na ordem das formas do logotipo. */
export const BRAND = {
  navy: "#1D2D3D",
  outline: "#416180",
  blue: "#70B3F7", // Nova Text
  green: "#73C385", // Nova Sheets
  orange: "#ED946C", // Nova Slides
  lilac: "#D094DD", // Nova Draw
  gold: "#D1A84B", // Nova Base
  teal: "#2AC4CC", // Nova Math
} as const;

export type BrandApp = "text" | "sheets" | "slides" | "draw" | "base" | "math";

/**
 * O símbolo da marca. Sem `app`, todas as formas coloridas (logotipo);
 * com `app`, só a forma daquele aplicativo colorida e as demais em contorno.
 */
export function BrandMark({ app, size = 24 }: { app?: BrandApp; size?: number }) {
  const shape = (owner: BrandApp, color: string) =>
    !app || app === owner
      ? { fill: color }
      : { fill: "none", stroke: BRAND.outline, strokeWidth: 6, strokeLinejoin: "round" as const };
  return (
    <svg width={size} height={size} viewBox="24 58 208 140" aria-hidden="true">
      <g {...shape("text", BRAND.blue)}>
        <rect x="32" y="66" width="60" height="20" />
        <rect x="32" y="98" width="26" height="20" />
      </g>
      <g {...shape("sheets", BRAND.green)}>
        <rect x="100" y="66" width="26" height="26" />
        <rect x="130" y="66" width="26" height="26" />
        <rect x="100" y="96" width="26" height="26" />
        <rect x="130" y="96" width="26" height="26" />
      </g>
      <path d="M166 66 L224 94 L166 122 Z" {...shape("slides", BRAND.orange)} />
      <circle cx="62" cy="162" r="30" {...shape("draw", BRAND.lilac)} />
      <path d="M100 132 A58 58 0 0 1 158 190 L100 190 Z" {...shape("base", BRAND.gold)} />
      <path d="M187 132h16v22h21v16h-21v22h-16v-22h-21v-16h21z" {...shape("math", BRAND.teal)} />
    </svg>
  );
}

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const icons = {
  new: (
    <Icon>
      <path d="M5 2.5h6.5l3.5 3.5v11.5H5z" />
      <path d="M11.5 2.5V6H15" />
      <path d="M10 9.5v5M7.5 12h5" />
    </Icon>
  ),
  open: (
    <Icon>
      <path d="M2.5 15.5V4.5h5l1.5 2h8.5v9z" />
      <path d="M2.5 9h15" />
    </Icon>
  ),
  save: (
    <Icon>
      <path d="M3.5 3.5h10l3 3v10h-13z" />
      <path d="M6.5 3.5v4h6v-4" />
      <path d="M6.5 16.5v-5h7v5" />
    </Icon>
  ),
  saveAs: (
    <Icon>
      <path d="M10 16.5H3.5v-13h10l3 3V10" />
      <path d="M6.5 3.5v4h6v-4" />
      <path d="M13 17.5l4.5-4.5-2-2-4.5 4.5v2z" />
    </Icon>
  ),
  export: (
    <Icon>
      <path d="M8 4.5H3.5v12h12V12" />
      <path d="M11 2.5h6.5V9" />
      <path d="M17.5 2.5L9 11" />
    </Icon>
  ),
  undo: (
    <Icon>
      <path d="M7 4L3.5 7.5 7 11" />
      <path d="M3.5 7.5h8.5a4.5 4.5 0 0 1 0 9H8" />
    </Icon>
  ),
  redo: (
    <Icon>
      <path d="M13 4l3.5 3.5L13 11" />
      <path d="M16.5 7.5H8a4.5 4.5 0 0 0 0 9h4" />
    </Icon>
  ),
  light: (
    <Icon>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6L16 16M4 16l1.4-1.4M14.6 5.4L16 4" />
    </Icon>
  ),
  dark: (
    <Icon>
      <path d="M16.5 12.5A7 7 0 0 1 7.5 3.5a7 7 0 1 0 9 9z" />
    </Icon>
  ),
  system: (
    <Icon>
      <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" />
      <path d="M7 17h6M10 13.5V17" />
    </Icon>
  ),
  language: (
    <Icon>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M2.5 10h15M10 2.5c2.2 2.3 3 4.8 3 7.5s-.8 5.2-3 7.5c-2.2-2.3-3-4.8-3-7.5s.8-5.2 3-7.5z" />
    </Icon>
  ),
  chevronUp: (
    <Icon width="16" height="16">
      <path d="M5 12.5L10 7.5l5 5" />
    </Icon>
  ),
  chevronDown: (
    <Icon width="16" height="16">
      <path d="M5 7.5l5 5 5-5" />
    </Icon>
  ),
} satisfies Record<string, ReactNode>;
