// Imagens: inserir no cursor, tamanho e o cache dos arquivos embutidos. Sem
// DOM além do cache; testado em images.test.ts.

import { blockText, caret, type Edit, type Selection } from "./model";
import type { DocView, ImageRef, TextCommand } from "./types";

/** Largura útil da página (A4 com margens de 2,5 cm), em pontos, como no núcleo. */
export const TEXT_WIDTH_PT = 482;
export const MAX_IMAGE_PT = 2000;

/**
 * Inserir → Imagens: no parágrafo vazio do cursor, a imagem entra nele; senão,
 * num parágrafo novo logo depois. O cursor fica no parágrafo da imagem.
 */
export function insertImage(doc: DocView, sel: Selection, image: ImageRef): Edit {
  const at = sel.focus.block;
  const block = doc.blocks[at];
  const setImage = (index: number): TextCommand => ({ type: "block.setAttr", block: index, attr: "image", value: image });
  if (blockText(block) === "" && !block.attrs.image) {
    return { command: setImage(at), selection: caret({ block: at, offset: 0 }) };
  }
  const index = at + 1;
  const commands: TextCommand[] = [{ type: "block.insert", index, text: "" }, setImage(index)];
  // Numa célula de tabela, a imagem fica na mesma célula.
  if (block.attrs.cell) commands.push({ type: "block.setAttr", block: index, attr: "cell", value: block.attrs.cell });
  return { command: { type: "batch", commands }, selection: caret({ block: index, offset: 0 }) };
}

/** Novo tamanho mantendo a proporção, a partir da largura em pontos. */
export function resizeImage(image: ImageRef, width: number): ImageRef {
  const w = Math.round(Math.min(Math.max(width, 8), MAX_IMAGE_PT));
  const h = Math.round(Math.min(Math.max((image.height * w) / image.width, 1), MAX_IMAGE_PT));
  return { ...image, width: w, height: h };
}

export function setImage(block: number, image: ImageRef | null): TextCommand {
  return { type: "block.setAttr", block, attr: "image", value: image };
}

// ---------- Cache dos arquivos ----------

const urls = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/** Data URL da imagem, buscada uma vez por id (o conteúdo de um id não muda). */
export function mediaUrl(id: string, fetch: (id: string) => Promise<string | null>): Promise<string | null> {
  const ready = urls.get(id);
  if (ready) return Promise.resolve(ready);
  let request = pending.get(id);
  if (!request) {
    request = fetch(id).then((url) => {
      if (url) urls.set(id, url);
      pending.delete(id);
      return url;
    });
    pending.set(id, request);
  }
  return request;
}

export const cachedMediaUrl = (id: string): string | undefined => urls.get(id);

/** Lê um arquivo (colado ou arrastado) como base64, sem o prefixo do data URL. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
