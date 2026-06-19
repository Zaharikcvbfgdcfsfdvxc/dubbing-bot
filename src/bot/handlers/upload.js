const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { scanDataDir, DATA_DIR } = require('../scanner');
const { downloadBuffer } = require('../utils');
const MSG = require('../messages');

// Track which users are in "waiting for ZIP" state (simple Set, not session-based)
const waitingForZip = new Set();

/**
 * Handle /upload command.
 * Prompts admin to send a ZIP file.
 */
async function handleUploadCommand(ctx) {
  const userId = ctx.from.id;
  waitingForZip.add(userId);

  return ctx.reply(
    '📦 *Загрузка проекта*\n\n' +
    'Отправь ZIP-файл со следующей структурой:\n\n' +
    '```\n' +
    'ProjectName/\n' +
    '  transcript.txt\n' +
    '  CharacterName/\n' +
    '    line01.wav\n' +
    '    line02.wav\n' +
    '```\n\n' +
    'Бот распакует файлы в `data/` и проиндексирует их.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '❌ Отмена', callback_data: 'cancel_upload' }
        ]]
      }
    }
  );
}

/**
 * Handle cancel upload callback.
 */
async function handleCancelUpload(ctx) {
  waitingForZip.delete(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'Загрузка отменена.' });
  return ctx.reply('Загрузка отменена. /upload — начать заново.');
}

/**
 * Handle incoming document (ZIP file) — check if user is in upload mode.
 */
async function handleDocument(ctx) {
  const userId = ctx.from.id;

  // If user is not in upload mode, ignore document
  if (!waitingForZip.has(userId)) {
    return ctx.reply(
      'Чтобы загрузить проект, сначала отправь команду /upload'
    );
  }

  const doc = ctx.message.document;
  if (!doc) return;

  // Check file extension
  const fileName = doc.file_name || '';
  if (!/\.zip$/i.test(fileName)) {
    return ctx.reply('❌ Отправь ZIP-файл (с расширением .zip).');
  }

  // Check file size (Telegram limit is 20MB for bots, but let's be safe)
  if (doc.file_size > 50 * 1024 * 1024) {
    waitingForZip.delete(userId);
    return ctx.reply('❌ Файл слишком большой (макс. 50 МБ).');
  }

  waitingForZip.delete(userId);
  const statusMsg = await ctx.reply('⏳ Скачиваю и распаковываю архив...');

  try {
    // Download file from Telegram
    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    // Download to buffer
    const zipBuffer = await downloadBuffer(fileUrl);

    // Extract ZIP
    const zip = await JSZip.loadAsync(zipBuffer);
    await extractProjectZip(zip, DATA_DIR);

    await ctx.api.editMessageText(
      statusMsg.chat.id,
      statusMsg.message_id,
      '✅ Архив распакован. Сканирую реплики...'
    );

    // Re-scan data directory
    const stats = scanDataDir();

    return ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {}).then(() =>
      ctx.reply(
        `✅ *Проект загружен и проиндексирован!*\n\n` +
        `📁 Проектов: ${stats.projects}\n` +
        `🎭 Персонажей: ${stats.characters}\n` +
        `🎬 Реплик: ${stats.replicas}\n\n` +
        `Отправь /start чтобы начать озвучку.`,
        { parse_mode: 'Markdown' }
      )
    );
  } catch (err) {
    console.error('[upload] Error:', err);
    return ctx.reply('❌ Ошибка при обработке архива: ' + (err.message || 'неизвестная ошибка'));
  }
}

/**
 * Extract a ZIP file into the data directory.
 * Expected structure:
 *   ProjectName/
 *     transcript.txt
 *     CharacterName/
 *       *.wav
 */
async function extractProjectZip(zip, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    // Normalize path — strip any top-level wrapper folder or keep as-is
    let cleanPath = entryPath.replace(/\\/g, '/');
    // Remove leading slash if any
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);

    const fullPath = path.join(destDir, cleanPath);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file
    const content = await entry.async('nodebuffer');
    fs.writeFileSync(fullPath, content);
    console.log(`[upload] Extracted: ${cleanPath}`);
  }
}

module.exports = {
  handleUploadCommand,
  handleCancelUpload,
  handleDocument,
};
