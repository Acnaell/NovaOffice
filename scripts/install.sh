#!/bin/sh
# Instala o CLI `nova` da NovaOffice a partir do GitHub Releases (Linux e macOS).
#
#   curl -fsSL https://raw.githubusercontent.com/Acnaell/novaoffice/main/scripts/install.sh | sh
#
# Variáveis opcionais:
#   NOVA_VERSION      tag a instalar (padrão: a versão mais recente, ex.: v0.1.0)
#   NOVA_INSTALL_DIR  pasta de destino (padrão: ~/.local/bin)
set -eu

REPO="Acnaell/novaoffice"
INSTALL_DIR="${NOVA_INSTALL_DIR:-$HOME/.local/bin}"

case "$(uname -s)" in
  Linux)  os="unknown-linux-gnu" ;;
  Darwin) os="apple-darwin" ;;
  *) echo "Sistema não suportado: $(uname -s). No Windows use install.ps1." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64)  arch="x86_64" ;;
  arm64 | aarch64) arch="aarch64" ;;
  *) echo "Arquitetura não suportada: $(uname -m)" >&2; exit 1 ;;
esac

target="${arch}-${os}"
asset="nova-${target}.tar.gz"
if [ -n "${NOVA_VERSION:-}" ]; then
  base="https://github.com/${REPO}/releases/download/${NOVA_VERSION}"
else
  base="https://github.com/${REPO}/releases/latest/download"
fi

if command -v curl > /dev/null; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget > /dev/null; then
  fetch() { wget -qO "$2" "$1"; }
else
  echo "Instale curl ou wget para continuar." >&2; exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Baixando ${asset}..."
fetch "${base}/${asset}" "${tmp}/${asset}"
fetch "${base}/${asset}.sha256" "${tmp}/${asset}.sha256"

expected="$(cut -d ' ' -f 1 < "${tmp}/${asset}.sha256")"
if command -v sha256sum > /dev/null; then
  actual="$(sha256sum "${tmp}/${asset}" | cut -d ' ' -f 1)"
else
  actual="$(shasum -a 256 "${tmp}/${asset}" | cut -d ' ' -f 1)"
fi
if [ "$expected" != "$actual" ]; then
  echo "Falha na verificação SHA-256 do download." >&2; exit 1
fi

tar -xzf "${tmp}/${asset}" -C "$tmp"
mkdir -p "$INSTALL_DIR"
install -m 755 "${tmp}/nova-${target}/nova" "${INSTALL_DIR}/nova"

echo "Instalado: ${INSTALL_DIR}/nova ($("${INSTALL_DIR}/nova" --version))"
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*) ;;
  *) echo "Adicione ${INSTALL_DIR} ao PATH, por exemplo: export PATH=\"${INSTALL_DIR}:\$PATH\"" ;;
esac
