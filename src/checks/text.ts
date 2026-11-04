// Lowercases and folds curly apostrophes so patterns can use a plain '.
export function normalizeText(text: string): string {
  return text.replace(/[‘’]/g, "'").toLowerCase();
}
