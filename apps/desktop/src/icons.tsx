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
  paste: (
    <Icon>
      <path d="M7 3.5H4.5v13H9" />
      <path d="M13 3.5h2.5V7" />
      <rect x="7" y="2" width="6" height="3" rx="1" />
      <rect x="10" y="9" width="7.5" height="9" rx="1" />
      <path d="M12 12h3.5M12 14.5h3.5" />
    </Icon>
  ),
  cut: (
    <Icon>
      <circle cx="5.5" cy="14.5" r="2.5" />
      <circle cx="14.5" cy="14.5" r="2.5" />
      <path d="M7.3 12.7L15 2.5M12.7 12.7L5 2.5" />
    </Icon>
  ),
  copy: (
    <Icon>
      <rect x="7" y="6.5" width="9.5" height="11" rx="1" />
      <path d="M13 6.5V3.5H3.5v11h3.5" />
    </Icon>
  ),
  painter: (
    <Icon>
      <rect x="3" y="2.5" width="11" height="5" rx="1" />
      <path d="M14 5h2.5v4.5H9.5v2.5" />
      <path d="M8 12h3v5.5H8z" />
    </Icon>
  ),
  grow: (
    <Icon>
      <path d="M2.5 17L7 5l4.5 12M4.2 12.5h5.6" />
      <path d="M13.5 6l2-2.5 2 2.5" />
    </Icon>
  ),
  shrink: (
    <Icon>
      <path d="M3 17l3.5-9 3.5 9M4.3 13.7h4.4" />
      <path d="M13.5 4l2 2.5 2-2.5" />
    </Icon>
  ),
  changeCase: (
    <Icon>
      <path d="M1.5 16L5.5 5l4 11M2.9 12.3h5.2" />
      <path d="M16.5 10.5v5.5M16.5 12.5a2.5 2.5 0 1 0 0 2" />
    </Icon>
  ),
  clearFormat: (
    <Icon>
      <path d="M3 16.5L7.5 4.5l3.2 8.5M4.8 12h5" />
      <path d="M12 16.5l2-3.5 3 1.7-2 3.5z" />
      <path d="M12.5 17.5h5" />
    </Icon>
  ),
  subscript: (
    <Icon>
      <path d="M3 4.5l7 9M10 4.5l-7 9" />
      <path d="M13.5 13.5a1.8 1.8 0 1 1 3 1.4l-3 3h3.5" />
    </Icon>
  ),
  superscript: (
    <Icon>
      <path d="M3 7.5l7 9M10 7.5l-7 9" />
      <path d="M13.5 4a1.8 1.8 0 1 1 3 1.4l-3 3h3.5" />
    </Icon>
  ),
  highlight: (
    <Icon>
      <path d="M11.5 3l4 4-6 6H5.5V9z" />
      <path d="M5.5 13L3 15.5h4" />
    </Icon>
  ),
  fontColor: (
    <Icon>
      <path d="M5 14L10 2.5 15 14M6.8 10h6.4" />
    </Icon>
  ),
  bullets: (
    <Icon>
      <circle cx="4" cy="5" r="0.6" fill="currentColor" />
      <circle cx="4" cy="10" r="0.6" fill="currentColor" />
      <circle cx="4" cy="15" r="0.6" fill="currentColor" />
      <path d="M8 5h9M8 10h9M8 15h9" />
    </Icon>
  ),
  numbering: (
    <Icon strokeWidth="1.5">
      <path d="M3 3.5l1.5-1v5" />
      <path d="M2.8 11a1.4 1.4 0 1 1 2.4 1l-2.4 2.5h2.8" />
      <path d="M8 5h9M8 10h9M8 15h9" strokeWidth="1.75" />
    </Icon>
  ),
  outdent: (
    <Icon>
      <path d="M3 3.5h14M9 8h8M9 12h8M3 16.5h14" />
      <path d="M6 7.5L3.5 10 6 12.5" />
    </Icon>
  ),
  indent: (
    <Icon>
      <path d="M3 3.5h14M9 8h8M9 12h8M3 16.5h14" />
      <path d="M3.5 7.5L6 10l-2.5 2.5" />
    </Icon>
  ),
  pilcrow: (
    <Icon>
      <path d="M11 17V3M14.5 17V3M15.5 3H9a3.5 3.5 0 0 0 0 7h2" />
    </Icon>
  ),
  alignLeft: (
    <Icon>
      <path d="M3 4h14M3 8h9M3 12h14M3 16h9" />
    </Icon>
  ),
  alignCenter: (
    <Icon>
      <path d="M3 4h14M5.5 8h9M3 12h14M5.5 16h9" />
    </Icon>
  ),
  alignRight: (
    <Icon>
      <path d="M3 4h14M8 8h9M3 12h14M8 16h9" />
    </Icon>
  ),
  justify: (
    <Icon>
      <path d="M3 4h14M3 8h14M3 12h14M3 16h14" />
    </Icon>
  ),
  lineSpacing: (
    <Icon>
      <path d="M9 4.5h8.5M9 10h8.5M9 15.5h8.5" />
      <path d="M2.5 5.5L4.5 3l2 2.5M2.5 14.5l2 2.5 2-2.5M4.5 3.5v13" />
    </Icon>
  ),
  find: (
    <Icon>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.2 12.2l4.8 4.8" />
    </Icon>
  ),
  replace: (
    <Icon strokeWidth="1.5">
      <path d="M2.5 8l2-5.5 2 5.5M3.2 6.3h2.6" />
      <path d="M12 12.5h2.2a1.5 1.5 0 0 1 0 3H12v-6h2a1.4 1.4 0 0 1 0 2.8" />
      <path d="M9.5 4.5h4a2 2 0 0 1 2 2v1M14 6.5l1.5 1.5L17 6.5" strokeWidth="1.75" />
    </Icon>
  ),
  select: (
    <Icon>
      <path d="M5 2.5l10 7.5-4.5 1L13 16.5l-2 1-2.5-5.5L5 15z" />
    </Icon>
  ),
  caret: (
    <Icon width="10" height="10" viewBox="0 0 10 10" strokeWidth="1.5">
      <path d="M2.5 4l2.5 2.5L7.5 4" />
    </Icon>
  ),
  close: (
    <Icon width="16" height="16">
      <path d="M5 5l10 10M15 5L5 15" />
    </Icon>
  ),
  arrowUp: (
    <Icon width="16" height="16">
      <path d="M5 12.5L10 7.5l5 5" />
    </Icon>
  ),
  arrowDown: (
    <Icon width="16" height="16">
      <path d="M5 7.5l5 5 5-5" />
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
  shading: (
    <Icon>
      <path d="M8.5 3l6 6-5.5 5.5a1 1 0 0 1-1.4 0L3 9.9a1 1 0 0 1 0-1.4z" />
      <path d="M4 9h10" />
      <path d="M16.5 11.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8z" />
    </Icon>
  ),
  margins: (
    <Icon>
      <path d="M4.5 2.5h11v15h-11z" />
      <path d="M4.5 5.5h11M4.5 14.5h11M7.5 2.5v15M12.5 2.5v15" strokeDasharray="1.5 1.5" />
    </Icon>
  ),
  portrait: (
    <Icon>
      <path d="M5.5 2.5h9v15h-9z" />
      <path d="M8 6h4M8 9h4M8 12h4" />
    </Icon>
  ),
  landscape: (
    <Icon>
      <path d="M2.5 5.5h15v9h-15z" />
      <path d="M6 8.5h8M6 11.5h8" />
    </Icon>
  ),
  paperSize: (
    <Icon>
      <path d="M3.5 5.5h8v12h-8z" />
      <path d="M7.5 5.5V2.5h9v12h-5" />
    </Icon>
  ),
  picture: (
    <Icon>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" />
      <circle cx="7" cy="8" r="1.5" />
      <path d="M2.5 14.5l4.5-4 3 2.5 3.5-3.5 4 4" />
    </Icon>
  ),
  table: (
    <Icon>
      <rect x="2.5" y="3.5" width="15" height="13" rx="1" />
      <path d="M2.5 8h15M2.5 12.25h15M7.5 3.5v13M12.5 3.5v13" />
    </Icon>
  ),
  rowAbove: (
    <Icon>
      <rect x="2.5" y="9" width="15" height="8" rx="1" />
      <path d="M2.5 13h15M10 2.5v5M7.5 5h5" />
    </Icon>
  ),
  rowBelow: (
    <Icon>
      <rect x="2.5" y="3" width="15" height="8" rx="1" />
      <path d="M2.5 7h15M10 12.5v5M7.5 15h5" />
    </Icon>
  ),
  colLeft: (
    <Icon>
      <rect x="9" y="2.5" width="8" height="15" rx="1" />
      <path d="M13 2.5v15M2.5 10h5M5 7.5v5" />
    </Icon>
  ),
  colRight: (
    <Icon>
      <rect x="3" y="2.5" width="8" height="15" rx="1" />
      <path d="M7 2.5v15M12.5 10h5M15 7.5v5" />
    </Icon>
  ),
  tableDelete: (
    <Icon>
      <rect x="2.5" y="3.5" width="12" height="11" rx="1" />
      <path d="M2.5 9h12M8.5 3.5v11M13 13l4.5 4.5M17.5 13L13 17.5" />
    </Icon>
  ),
  pageBreak: (
    <Icon>
      <path d="M5 2.5h10v5H5z" />
      <path d="M5 12.5h10v5H5z" />
      <path d="M2.5 10h2M7 10h2M11 10h2M15.5 10h2" />
    </Icon>
  ),
  link: (
    <Icon>
      <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2L10 5.8" />
      <path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1.1-1.1" />
    </Icon>
  ),
  calendar: (
    <Icon>
      <rect x="3" y="4" width="14" height="13" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" />
      <path d="M6.5 11h1.5M9.25 11h1.5M12 11h1.5M6.5 14h1.5M9.25 14h1.5" />
    </Icon>
  ),
  omega: (
    <Icon>
      <path d="M4 16.5h4v-2.2A5.5 5.5 0 1 1 12 14.3v2.2h4" />
    </Icon>
  ),
  grid: (
    <Icon>
      <rect x="3" y="3" width="3.5" height="3.5" />
      <rect x="8.25" y="3" width="3.5" height="3.5" />
      <rect x="13.5" y="3" width="3.5" height="3.5" />
      <rect x="3" y="8.25" width="3.5" height="3.5" />
      <rect x="8.25" y="8.25" width="3.5" height="3.5" />
      <rect x="13.5" y="8.25" width="3.5" height="3.5" />
      <rect x="3" y="13.5" width="3.5" height="3.5" />
      <rect x="8.25" y="13.5" width="3.5" height="3.5" />
      <rect x="13.5" y="13.5" width="3.5" height="3.5" />
    </Icon>
  ),
  home: (
    <Icon>
      <path d="M2.5 9.5L10 3l7.5 6.5" />
      <path d="M4.5 8v8.5h4v-5h3v5h4V8" />
    </Icon>
  ),
  print: (
    <Icon>
      <path d="M5.5 7.5v-5h9v5" />
      <rect x="2.5" y="7.5" width="15" height="7" rx="1" />
      <path d="M5.5 12.5h9v5h-9z" />
    </Icon>
  ),
  pdf: (
    <Icon>
      <path d="M5 2.5h6.5l3.5 3.5v11.5H5z" />
      <path d="M11.5 2.5V6H15" />
      <path d="M7 14.5c2-1 4-4 3-6.5-1 2.5 1 5 3.5 5.5" />
    </Icon>
  ),
  closeDoc: (
    <Icon>
      <path d="M5 2.5h6.5l3.5 3.5v11.5H5z" />
      <path d="M8 10l4 4M12 10l-4 4" />
    </Icon>
  ),
  arrowLeft: (
    <Icon>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M11 6.5L7.5 10l3.5 3.5M7.5 10h6" />
    </Icon>
  ),
  download: (
    <Icon>
      <path d="M10 3v9.5M6 8.5l4 4 4-4" />
      <path d="M3.5 13.5v3h13v-3" />
    </Icon>
  ),
  info: (
    <Icon>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 9v5M10 6.2v.1" />
    </Icon>
  ),
} satisfies Record<string, ReactNode>;
