// Tabela de atalhos de teclado. Há um perfil por idioma, com os mesmos
// atalhos do Microsoft Word naquele idioma: no Word em português, Ctrl+N é
// negrito, Ctrl+S sublinhado e Ctrl+B salvar. Para trocar ou acrescentar um
// atalho, basta editar PROFILES: o teclado e as dicas dos botões leem daqui.

export type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "file.print"
  | "edit.undo"
  | "edit.redo"
  | "edit.cut"
  | "edit.copy"
  | "edit.paste"
  | "edit.pasteText"
  | "edit.selectAll"
  | "edit.find"
  | "edit.replace"
  | "format.bold"
  | "format.italic"
  | "format.underline"
  | "format.strike"
  | "format.subscript"
  | "format.superscript"
  | "format.clear"
  | "format.grow"
  | "format.shrink"
  | "format.case"
  | "format.painter"
  | "format.copyFormat"
  | "format.pasteFormat"
  | "para.alignLeft"
  | "para.alignCenter"
  | "para.alignRight"
  | "para.justify"
  | "para.bullets"
  | "para.numbering"
  | "para.indent"
  | "para.outdent"
  | "para.spacing1"
  | "para.spacing15"
  | "para.spacing2"
  | "para.showMarks"
  | "style.paragraph"
  | "style.heading1"
  | "style.heading2"
  | "style.heading3"
  | "style.heading4"
  | "style.heading5"
  | "style.heading6"
  | "style.quote"
  | "style.code";

export type Profile = "word-pt" | "word-en";
type Bindings = Partial<Record<CommandId, string[]>>;

/** Atalhos que são iguais no Word em qualquer idioma. */
const COMMON: Bindings = {
  "file.print": ["Ctrl+P", "Ctrl+Shift+F12"],
  "edit.undo": ["Ctrl+Z"],
  "format.italic": ["Ctrl+I"],
  "format.strike": ["Alt+Shift+5"],
  "format.subscript": ["Ctrl+Equal"],
  "format.superscript": ["Ctrl+Shift+Equal"],
  "format.clear": ["Ctrl+Space"],
  "format.grow": ["Ctrl+Shift+Period", "Ctrl+BracketRight"],
  "format.shrink": ["Ctrl+Shift+Comma", "Ctrl+BracketLeft"],
  "format.case": ["Shift+F3"],
  "format.copyFormat": ["Ctrl+Shift+C"],
  "format.pasteFormat": ["Ctrl+Shift+V"],
  "para.alignCenter": ["Ctrl+E"],
  "para.justify": ["Ctrl+J"],
  "para.bullets": ["Ctrl+Shift+L"],
  "para.indent": ["Ctrl+M"],
  "para.outdent": ["Ctrl+Shift+M"],
  "para.spacing1": ["Ctrl+1"],
  "para.spacing2": ["Ctrl+2"],
  "para.spacing15": ["Ctrl+5"],
  "para.showMarks": ["Ctrl+Shift+8"],
  "style.paragraph": ["Ctrl+Alt+0"],
  "style.heading1": ["Ctrl+Alt+1"],
  "style.heading2": ["Ctrl+Alt+2"],
  "style.heading3": ["Ctrl+Alt+3"],
  "style.heading4": ["Ctrl+Alt+4"],
  "style.heading5": ["Ctrl+Alt+5"],
  "style.heading6": ["Ctrl+Alt+6"],
};

export const PROFILES: Record<Profile, Bindings> = {
  "word-pt": {
    ...COMMON,
    "file.new": ["Ctrl+O"],
    "file.open": ["Ctrl+A", "Ctrl+F12"],
    "file.save": ["Ctrl+B", "Shift+F12"],
    "file.saveAs": ["F12"],
    "edit.redo": ["Ctrl+R", "Ctrl+Y"],
    "edit.selectAll": ["Ctrl+T"],
    "edit.find": ["Ctrl+L", "Ctrl+F"],
    "edit.replace": ["Ctrl+U", "Ctrl+H"],
    "format.bold": ["Ctrl+N"],
    "format.underline": ["Ctrl+S"],
    "para.alignLeft": ["Ctrl+Q"],
    "para.alignRight": ["Ctrl+G"],
  },
  "word-en": {
    ...COMMON,
    "file.new": ["Ctrl+N"],
    "file.open": ["Ctrl+O", "Ctrl+F12"],
    "file.save": ["Ctrl+S", "Shift+F12"],
    "file.saveAs": ["F12", "Ctrl+Shift+S"],
    "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"],
    "edit.selectAll": ["Ctrl+A"],
    "edit.find": ["Ctrl+F"],
    "edit.replace": ["Ctrl+H"],
    "format.bold": ["Ctrl+B"],
    "format.underline": ["Ctrl+U"],
    "para.alignLeft": ["Ctrl+L"],
    "para.alignRight": ["Ctrl+R"],
  },
};

/** Perfil de atalhos que acompanha o idioma da interface. */
export const profileFor = (locale: string): Profile => (locale.startsWith("pt") ? "word-pt" : "word-en");

interface Combo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

export function parseCombo(text: string): Combo {
  const parts = text.split("+").map((p) => p.trim());
  const mods = new Set(parts.slice(0, -1).map((p) => p.toLowerCase()));
  return {
    ctrl: mods.has("ctrl"),
    alt: mods.has("alt"),
    shift: mods.has("shift"),
    key: parts[parts.length - 1].toLowerCase(),
  };
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "keyCode" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Teclas de pontuação comparadas pela posição física (`code`), que não muda com Shift nem com o layout. */
const PHYSICAL = new Set(["equal", "minus", "period", "comma", "bracketleft", "bracketright", "space", "slash"]);

/** Como a tecla aparece nas dicas dos botões. */
const DISPLAY: Record<string, string> = {
  Equal: "=",
  Minus: "-",
  Period: ".",
  Comma: ",",
  BracketLeft: "[",
  BracketRight: "]",
  Space: "Espaço",
  Slash: "/",
};

/**
 * Letras seguem o layout (`key`), como Ctrl+Z num teclado AZERTY; só quando
 * `key` não é uma letra (Ctrl+Alt vira AltGr) vale a tecla física. Dígitos e
 * pontuação são sempre pela tecla física (`code`): no ABNT2, Ctrl+Alt+1
 * chegaria como "¹" e Alt+Shift+5 como "%". Sem `code`, vale o código virtual.
 */
function keyMatches(e: KeyEventLike, key: string): boolean {
  if (/^[a-z]$/.test(key)) {
    const typed = e.key.toLowerCase();
    return /^[a-z]$/.test(typed) ? typed === key : e.code === `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return e.code ? e.code === `Digit${key}` : e.keyCode === 48 + Number(key);
  }
  if (PHYSICAL.has(key)) return e.code.toLowerCase() === key;
  return e.key.toLowerCase() === key;
}

export function comboMatches(e: KeyEventLike, combo: Combo): boolean {
  return (
    (e.ctrlKey || e.metaKey) === combo.ctrl &&
    e.altKey === combo.alt &&
    e.shiftKey === combo.shift &&
    keyMatches(e, combo.key)
  );
}

const PARSED = Object.fromEntries(
  (Object.keys(PROFILES) as Profile[]).map((profile) => [
    profile,
    Object.entries(PROFILES[profile]).flatMap(([command, combos]) =>
      (combos ?? []).map((c) => ({ command: command as CommandId, combo: parseCombo(c) })),
    ),
  ]),
) as Record<Profile, { command: CommandId; combo: Combo }[]>;

export function matchShortcut(e: KeyEventLike, profile: Profile = "word-en"): CommandId | null {
  return PARSED[profile].find(({ combo }) => comboMatches(e, combo))?.command ?? null;
}

/** "Ctrl+Shift+Equal" → "Ctrl+Shift+=". */
export function displayCombo(combo: string): string {
  return combo
    .split("+")
    .map((part) => DISPLAY[part] ?? part)
    .join("+");
}

/** "Negrito (Ctrl+N)" — o rótulo com o atalho principal, para dicas. */
export function withShortcut(label: string, command: CommandId, profile: Profile = "word-en"): string {
  const combo = PROFILES[profile][command]?.[0];
  return combo ? `${label} (${displayCombo(combo)})` : label;
}
