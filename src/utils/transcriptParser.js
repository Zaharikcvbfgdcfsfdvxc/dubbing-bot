/**
 * Parse a transcript text file into a Map.
 * Supports multiple formats:
 *
 * 1. Tab-separated:
 *    filename.wav\tEN transcript\tRU translation
 *
 * 2. Pipe-separated:
 *    filename.wav | EN transcript | RU translation
 *
 * 3. Block format:
 *    Media ID: filename.wav
 *    Readable ID: char_name
 *    EN: English text
 *    RU: Русский текст
 *    Recognized: recognized text
 *    ---
 *
 * Key = basename without .wav (lowercase)
 * Value = { transcript, translation }
 */
function parseTranscriptText(text) {
  const map = new Map();
  const lines = text.split(/\r?\n/);

  // Block-format accumulator
  let block = { mediaId: null, readableId: null, en: null, ru: null, recognized: null };

  const flushBlock = () => {
    const defaultText = block.recognized || block.en || '';
    const translation = block.ru || '';
    const ids = [];
    if (block.readableId) ids.push(block.readableId);
    if (block.mediaId) ids.push(block.mediaId);
    ids.forEach(id => {
      if (!id) return;
      const key = id.replace(/\.wav$/i, '').toLowerCase();
      if (!map.has(key)) {
        map.set(key, { transcript: defaultText, translation });
      }
    });
    block = { mediaId: null, readableId: null, en: null, ru: null, recognized: null };
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // --- Format 1: Tab-separated ---
    const tabParts = line.split(/\t/).map(p => p.trim()).filter(Boolean);
    if (tabParts.length >= 2 && /\.wav$/i.test(tabParts[0])) {
      const name = tabParts[0].replace(/\.wav$/i, '');
      map.set(name.toLowerCase(), {
        transcript: tabParts[1] || '',
        translation: tabParts.slice(2).join(' ') || ''
      });
      continue;
    }

    // --- Format 2: Pipe-separated ---
    const pipeParts = line.split(/\|/).map(p => p.trim()).filter(Boolean);
    if (pipeParts.length >= 2 && /\.wav$/i.test(pipeParts[0])) {
      const name = pipeParts[0].replace(/\.wav$/i, '');
      map.set(name.toLowerCase(), {
        transcript: pipeParts[1] || '',
        translation: pipeParts.slice(2).join(' ') || ''
      });
      continue;
    }

    // --- Format 3: Block format ---
    const mediaMatch = line.match(/^Media\s+ID:\s*(\S+)/i);
    if (mediaMatch) {
      if (block.mediaId || block.readableId || block.en || block.ru || block.recognized) flushBlock();
      block.mediaId = mediaMatch[1];
      continue;
    }

    const readableMatch = line.match(/^Readable\s+ID:\s*(\S+)/i);
    if (readableMatch) {
      block.readableId = readableMatch[1];
      continue;
    }

    const enMatch = line.match(/^EN:\s*(.+)$/i);
    if (enMatch) {
      block.en = enMatch[1].trim();
      continue;
    }

    const ruMatch = line.match(/^RU:\s*(.+)$/i);
    if (ruMatch) {
      block.ru = ruMatch[1].trim();
      continue;
    }

    const recognizedMatch = line.match(/^Recognized:\s*(.+)$/i);
    if (recognizedMatch) {
      block.recognized = recognizedMatch[1].trim();
      continue;
    }

    // Block separator
    if (/^-{2,}$/i.test(line)) {
      flushBlock();
    }
  }

  // Flush last block
  flushBlock();

  return map;
}

/**
 * Parse a single replica transcript.txt (new format).
 * Format:
 *   Оригинал:
 *   English text
 *
 *   Перевод:
 *   Russian text
 *
 * @param {string} text
 * @returns {{ transcript: string, translation: string }}
 */
function parseReplicaTranscript(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  const originalMatch = normalized.match(/Оригинал:\s*\n([\s\S]+?)(?:\n\nПеревод:|$)/i);
  const translationMatch = normalized.match(/Перевод:\s*\n([\s\S]+?)$/i);

  return {
    transcript: originalMatch ? originalMatch[1].trim() : '',
    translation: translationMatch ? translationMatch[1].trim() : ''
  };
}

module.exports = { parseTranscriptText, parseReplicaTranscript };
