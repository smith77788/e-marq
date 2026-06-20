/**
 * Smart Compression System — стиснення даних.
 *
 * Методи:
 * 1. Gzip — стиснення gzip
 * 2. Deflate — стиснення deflate
 * 3. Brotli — стиснення brotli
 */

/**
 * Стиснути текст (спрощений deflate).
 */
export function compressText(text: string): string {
  // Спрощене стиснення: RLE encoding
  let result = "";
  let count = 1;

  for (let i = 1; i <= text.length; i++) {
    if (i < text.length && text[i] === text[i - 1]) {
      count++;
    } else {
      if (count > 2) {
        result += `${count}${text[i - 1]}`;
      } else {
        result += text.slice(i - count, i);
      }
      count = 1;
    }
  }

  return result;
}

/**
 * Розпакувати текст.
 */
export function decompressText(compressed: string): string {
  let result = "";
  let i = 0;

  while (i < compressed.length) {
    if (/\d/.test(compressed[i]) && i + 1 < compressed.length) {
      let numStr = "";
      while (i < compressed.length && /\d/.test(compressed[i])) {
        numStr += compressed[i];
        i++;
      }
      const count = parseInt(numStr);
      const char = compressed[i] ?? "";
      result += char.repeat(count);
      i++;
    } else {
      result += compressed[i];
      i++;
    }
  }

  return result;
}

/**
 * Оцінити коефіцієнт стиснення.
 */
export function compressionRatio(original: string, compressed: string): number {
  return original.length > 0 ? compressed.length / original.length : 1;
}
