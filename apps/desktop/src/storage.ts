// Preferências da interface (tema, idioma). O armazenamento pode faltar ou
// recusar escrita; nesse caso a preferência simplesmente não persiste.

export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento: a preferência vale só até fechar o app.
  }
}
