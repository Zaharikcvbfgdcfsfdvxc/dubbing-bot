const path = require('path');
const fs = require('fs');
const db = require('../../db/index');
const MSG = require('../messages');
const { reviewKeyboard } = require('../keyboards');
const { downloadBuffer } = require('../utils');

const RECORDINGS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'recordings');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Handle incoming voice messages.
 * The user must be in DUBBING state.
 */
async function handleVoice(ctx) {
  // Ensure user exists
  const user = db.getUserByTelegramId(ctx.from.id);
  if (!user) {
    return ctx.reply('Сначала отправь /start', { parse_mode: 'Markdown' });
  }

  const session = ctx.session;

  // Allow re-recording while in REVIEWING state
  if (session.state !== 'DUBBING' && session.state !== 'REVIEWING') {
    return ctx.reply(
      'Сейчас не ожидается дубляж. Начни заново: /start',
      { parse_mode: 'Markdown' }
    );
  }

  // If user was reviewing previous attempt, clean up old recording
  if (session.state === 'REVIEWING' && session.currentDubId) {
    const oldDub = db.getDb().prepare('SELECT * FROM user_dubs WHERE id = ?').get(session.currentDubId);
    if (oldDub && oldDub.audio_path && fs.existsSync(oldDub.audio_path)) {
      try { fs.unlinkSync(oldDub.audio_path); } catch {}
    }
    db.discardDub(session.currentDubId);
  }

  const characterId = session.characterId;
  if (!characterId) {
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }

  const voice = ctx.message.voice;
  if (!voice) {
    return ctx.reply(MSG.noVoice, { parse_mode: 'Markdown' });
  }

  // Telegram voice messages are limited to ~20MB — should be fine
  // But we check anyway
  if (voice.file_size > 20 * 1024 * 1024) {
    return ctx.reply(MSG.voiceTooBig, { parse_mode: 'Markdown' });
  }

  try {
    // Get file info from Telegram
    const file = await ctx.api.getFile(voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    // Save to disk
    const userDir = path.join(RECORDINGS_DIR, String(ctx.from.id));
    ensureDir(userDir);

    const ext = file.file_path ? path.extname(file.file_path) : '.ogg';
    const filename = `${Date.now()}_${voice.file_unique_id}${ext}`;
    const destPath = path.join(userDir, filename);

    const voiceBuffer = await downloadBuffer(fileUrl);
    fs.writeFileSync(destPath, voiceBuffer);

    // Find the current pending replica
    const replica = db.getNextPendingReplica(user.id, characterId);
    if (!replica) {
      return ctx.reply('Все реплики уже озвучены! Начни заново: /start', { parse_mode: 'Markdown' });
    }

    // Get or create dub record
    const dub = db.getOrCreateDub(user.id, replica.id);

    // Save the audio path in session for later submit
    session._lastVoicePath = destPath;
    session.currentDubId = dub.id;
    session.state = 'REVIEWING';

    // Send review prompt with buttons
    await ctx.reply(MSG.voiceReceived);
    await ctx.reply(MSG.reviewPrompt, {
      parse_mode: 'Markdown',
      reply_markup: reviewKeyboard(dub.id, characterId),
    });

  } catch (err) {
    console.error('[voice] Error processing voice:', err);
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }
}

module.exports = { handleVoice };
