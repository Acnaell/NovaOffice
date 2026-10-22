// Conversão entre posições do DOM (nó + offset) e posições do modelo (bloco + offset UTF-16).
// Cada parágrafo é um elemento com `data-block`; offsets do DOM já são UTF-16.

import type { Pos } from "./types";
import type { Selection } from "./model";

function blockElement(root: HTMLElement, node: Node): HTMLElement | null {
  let el: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  while (el && el !== root) {
    if (el instanceof HTMLElement && el.dataset.block !== undefined) return el;
    el = el.parentNode;
  }
  return null;
}

export function posFromDom(root: HTMLElement, node: Node, offset: number): Pos | null {
  if (node === root) {
    // Seleção no próprio contêiner (por exemplo, Ctrl+A): antes do filho `offset`.
    const blocks = root.querySelectorAll<HTMLElement>("[data-block]");
    if (blocks.length === 0) return null;
    if (offset >= blocks.length) {
      const last = blocks[blocks.length - 1];
      return { block: Number(last.dataset.block), offset: (last.textContent ?? "").length };
    }
    return { block: Number(blocks[offset].dataset.block), offset: 0 };
  }
  const el = blockElement(root, node);
  if (!el) return null;
  const range = document.createRange();
  range.setStart(el, 0);
  range.setEnd(node, offset);
  return { block: Number(el.dataset.block), offset: range.toString().length };
}

export function posToDom(root: HTMLElement, pos: Pos): [Node, number] | null {
  const el = root.querySelector<HTMLElement>(`[data-block="${pos.block}"]`);
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let remaining = pos.offset;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // Na fronteira entre dois trechos, fica no fim do da esquerda: o texto
    // digitado herda a formatação da esquerda, e o cursor acompanha.
    if (remaining <= node.length) return [node, remaining];
    remaining -= node.length;
    last = node;
  }
  return last ? [last, last.length] : [el, 0];
}

export function readSelection(root: HTMLElement): Selection | null {
  const sel = document.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode) return null;
  if (!root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  const anchor = posFromDom(root, sel.anchorNode, sel.anchorOffset);
  const focus = posFromDom(root, sel.focusNode, sel.focusOffset);
  return anchor && focus ? { anchor, focus } : null;
}

export function writeSelection(root: HTMLElement, selection: Selection): void {
  const anchor = posToDom(root, selection.anchor);
  const focus = posToDom(root, selection.focus);
  const sel = document.getSelection();
  if (!anchor || !focus || !sel) return;
  sel.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
}
