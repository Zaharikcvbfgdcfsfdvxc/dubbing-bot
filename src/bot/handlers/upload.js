const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { scanDataDir, DATA_DIR } = require('../scanner');
const { downloadBuffer } = require('../utils');
const MSG = require('../messages');

// Track which users are in "waiting for ZIP" state (simple Set, not session-based)
const waitingForZip = new Set();

// Track upload type: 'project' (full) or 'character' (needs project name)
const uploadContext = new Map(); // userId -> { type: 'project'|'character', zipBuffer? }

/**
 * Handle /upload command.
 * Prompts admin to send a ZIP file.
 */
async function handleUploadCommand(ctx) {
  const userId = ctx.from.id;
  waitingForZip.add(userId);

  return ctx.reply(
    '📦 *Загрузка проекта*\n\n' +
    'Отправь ZIP-файл со структурой:\n\n' +
    '```\n' +
    'ProjectName/\n' +
    '  {media_id}/\n' +
    '    original.wav\n' +
    '    transcript.txt\n' +
    '    info.json\n' +
    '```\n\n' +
    '`info.json`: `{"media_id": ..., "character": "..."}`\n' +
    '`transcript.txt`: `Оригинал:` / `Перевод:`',
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

  if (!waitingForZip.has(userId)) {
    return ctx.reply(
      'Чтобы загрузить проект, сначала отправь команду /upload'
    );
  }

  const doc = ctx.message.document;
  if (!doc) return;

  const fileName = doc.file_name || '';
  if (!/\.zip$/i.test(fileName)) {
    return ctx.reply('❌ Отправь ZIP-файл (с расширением .zip).');
  }

  // Telegram Bot API cannot download files > 20 MB
  if (doc.file_size > 20 * 1024 * 1024) {
    waitingForZip.delete(userId);
    const sizeMb = (doc.file_size / 1024 / 1024).toFixed(1);
    return ctx.reply(
      `❌ Файл слишком большой: ${sizeMb} МБ (макс. 20 МБ для ботов).\n\n` +
      `Разбей архив на части или загрузи файлы напрямую в папку data/ на сервере.`
    );
  }

  waitingForZip.delete(userId);
  const statusMsg = await ctx.reply('⏳ Скачиваю архив...');

  try {
    const file = await ctx.api.getFile(doc.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
    const zipBuffer = await downloadBuffer(fileUrl);
    const zip = await JSZip.loadAsync(zipBuffer);

    // Detect ZIP type: project (has character folders) or character (has media_id folders)
    const topEntries = Object.keys(zip.files)
      .map(p => p.replace(/\\/g, '/').split('/')[0])
      .filter((v, i, a) => a.indexOf(v) === i && v !== '' && !v.startsWith('.'));

    if (topEntries.length === 0) {
      return ctx.reply('❌ Архив пуст.');
    }

    // Check if top entry contains media_id subfolders (character ZIP)
    // A character ZIP: top/1005818535/original.wav → top is character folder
    // A project ZIP: top/CharacterName/1005818535/original.wav → top is project
    let isCharacterZip = false;
    for (const entry of topEntries) {
      const subPaths = Object.keys(zip.files)
        .filter(p => p.startsWith(entry + '/') || p.startsWith(entry + '\\'))
        .map(p => p.replace(/\\/g, '/').split('/')[1])
        .filter((v, i, a) => v && a.indexOf(v) === i);

      // If sub-entries contain folders with 'original.wav' or 'info.json', it's a character ZIP
      for (const sub of subPaths) {
        if (zip.files[`${entry}/${sub}/original.wav`] || zip.files[`${entry}\\${sub}\\original.wav`] ||
            zip.files[`${entry}/${sub}/info.json`] || zip.files[`${entry}\\${sub}\\info.json`]) {
          isCharacterZip = true;
          break;
        }
      }
      if (isCharacterZip) break;
    }

    if (isCharacterZip) {
      // Character ZIP — needs project name
      uploadContext.set(userId, { type: 'character', zipBuffer, zip });
      await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
      return ctx.reply(
        '📦 Архив содержит папку персонажа.\n\n' +
        'Введи *название проекта*, в который добавить персонажа:\n\n' +
        `Найден персонаж: \`${topEntries[0]}\``,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'cancel_upload' }]] },
        }
      );
    } else {
      // Full project ZIP
      await extractProjectZip(zip, DATA_DIR);
      await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, '✅ Распаковано. Сканирую...');

      const stats = scanDataDir();
      await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
      return ctx.reply(
        `✅ *Проект загружен!*\n\n` +
        `📁 Проектов: ${stats.projects}\n🎭 Персонажей: ${stats.characters}\n🎬 Реплик: ${stats.replicas}\n\n` +
        `/start чтобы начать озвучку.`,
        { parse_mode: 'Markdown' }
      );
    }
  } catch (err) {
    console.error('[upload] Error:', err);
    return ctx.reply('❌ Ошибка при обработке архива: ' + (err.message || 'неизвестная ошибка'));
  }
}

/**
 * Extract a ZIP file into the data directory preserving paths.
 */
async function extractProjectZip(zip, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    let cleanPath = entryPath.replace(/\\/g, '/');
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);

    const fullPath = path.join(destDir, cleanPath);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = await entry.async('nodebuffer');
    fs.writeFileSync(fullPath, content);
    console.log(`[upload] Extracted: ${cleanPath}`);
  }
}

/**
 * Handle text input during upload flow (project name for character ZIP).
 */
async function handleUploadText(ctx) {
  const userId = ctx.from.id;
  const context = uploadContext.get(userId);

  if (!context || context.type !== 'character') return;

  uploadContext.delete(userId);
  const projectName = ctx.message.text.trim();

  if (!projectName || projectName.length > 100) {
    return ctx.reply('❌ Некорректное название проекта. /upload — начать заново.');
  }

  const statusMsg = await ctx.reply('⏳ Распаковываю...');

  try {
    // Extract into data/{projectName}/ preserving character subfolder
    const destDir = path.join(DATA_DIR, projectName);
    await extractProjectZip(context.zip, destDir);

    await ctx.api.editMessageText(statusMsg.chat.id, statusMsg.message_id, '✅ Сканирую реплики...');

    const stats = scanDataDir();

    await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
    return ctx.reply(
      `✅ *Проект "${projectName}" загружен!*\n\n` +
      `📁 Проектов: ${stats.projects}\n🎭 Персонажей: ${stats.characters}\n🎬 Реплик: ${stats.replicas}\n\n` +
      `/start чтобы начать озвучку.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('[upload] Error:', err);
    return ctx.reply('❌ Ошибка: ' + (err.message || 'неизвестная ошибка'));
  }
}

module.exports = {
  handleUploadCommand,
  handleCancelUpload,
  handleDocument,
  handleUploadText,
};
