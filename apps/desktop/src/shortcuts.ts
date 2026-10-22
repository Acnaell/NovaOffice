// Tabela única de atalhos de teclado. Para trocar ou acrescentar um atalho,
// basta editar BINDINGS: o teclado e as dicas dos botões leem daqui.

export type CommandId =
  | "file.new"
  | "file.open"
  | "file.save"
  | "file.saveAs"
  | "edit.undo"
  | "edit.redo"
  | "format.bold"
  | "format.italic"
  | "format.underline"
  | "format.strike"
  | "style.paragraph"
  | "style.heading1"
  | "style.heading2"
  | "style.heading3"
  | "style.heading4"
  | "style.heading5"
  | "style.heading6"
  | "style.quote"
  | "style.code";

/** Combinações no formato "Ctrl+Shift+S"; a primeira aparece nas dicas. */
export const BINDINGS: Partial<Record<CommandId, string[]>> = {
  "file.new": ["Ctrl+N"],
  "file.open": ["Ctrl+O"],
  "file.save": ["Ctrl+S"],
  "file.saveAs": ["Ctrl+Shift+S"],
  "edit.undo": ["Ctrl+Z"],
  "edit.redo": ["Ctrl+Y", "Ctrl+Shift+Z"],
  "format.bold": ["Ctrl+B"],
  "format.italic": ["Ctrl+I"],
  "format.underline": ["Ctrl+U"],
  "format.strike": ["Alt+Shift+5"],
  "style.paragraph": ["Ctrl+Alt+0"],
  "style.heading1": ["Ctrl+Alt+1"],
  "style.heading2": ["Ctrl+Alt+2"],
  "style.heading3": ["Ctrl+Alt+3"],
  "style.heading4": ["Ctrl+Alt+4"],
  "style.heading5": ["Ctrl+Alt+5"],
  "style.heading6": ["Ctrl+Alt+6"],
};

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

/**
 * Letras seguem o layout (`key`), como Ctrl+Z num teclado AZERTY; só quando
 * `key` não é uma letra (Ctrl+Alt vira AltGr) vale a tecla física. Dígitos são
 * sempre pela tecla física (`code`): no ABNT2, Ctrl+Alt+1 chegaria como "¹" e
 * Alt+Shift+5 como "%". Sem `code`, vale o código virtual.
 */
function keyMatches(e: KeyEventLike, key: string): boolean {
  if (/^[a-z]$/.test(key)) {
    const typed = e.key.toLowerCase();
    return /^[a-z]$/.test(typed) ? typed === key : e.code === `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return e.code ? e.code === `Digit${key}` : e.keyCode === 48 + Number(key);
  }
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

const PARSED = Object.entries(BINDINGS).flatMap(([command, combos]) =>
  (combos ?? []).map((c) => ({ command: command as CommandId, combo: parseCombo(c) })),
);

export function matchShortcut(e: KeyEventLike): CommandId | null {
  return PARSED.find(({ combo }) => comboMatches(e, combo))?.command ?? null;
}

/** "Negrito (Ctrl+B)" — o rótulo com o atalho principal, para dicas. */
export function withShortcut(label: string, command: CommandId): string {
  const combo = BINDINGS[command]?.[0];
  return combo ? `${label} (${combo})` : label;
}
