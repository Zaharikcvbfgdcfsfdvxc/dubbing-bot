const path = require('path');
const fs = require('fs');
const db = require('../../db/index');
const MSG = require('../messages');
const { reviewKeyboard } = require('../keyboards');
const { downloadBuffer } = require('../utils');
const { downloadThroughProxy, hasProxy } = require('../proxy');

const RECORDINGS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'recordings');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

async function handleVoice(ctx) {
  const user = await db.getUserByTelegramId(ctx.from.id);
  if (!user) return ctx.reply('Сначала /start', { parse_mode: 'Markdown' });

  const session = ctx.session;
  if (session.state !== 'DUBBING' && session.state !== 'REVIEWING') {
    return ctx.reply('Сейчас не ожидается дубляж. /start — начать заново.', { parse_mode: 'Markdown' });
  }

  const voice = ctx.message.voice;
  if (!voice) return ctx.reply(MSG.noVoice, { parse_mode: 'Markdown' });

  if (session.state === 'REVIEWING' && session.currentDubId) {
    const oldDub = await db.getDubById(session.currentDubId);
    if (oldDub && oldDub.audio_path && fs.existsSync(oldDub.audio_path)) {
      try { fs.unlinkSync(oldDub.audio_path); } catch {}
    }
    await db.discardDub(session.currentDubId);
  }

  try {
    const file = await ctx.api.getFile(voice.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;

    const userDir = path.join(RECORDINGS_DIR, String(ctx.from.id));
    ensureDir(userDir);
    const ext = file.file_path ? path.extname(file.file_path) : '.ogg';
    const destPath = path.join(userDir, `${Date.now()}_${voice.file_unique_id}${ext}`);

    const voiceBuffer = hasProxy ? await downloadThroughProxy(fileUrl) : await downloadBuffer(fileUrl);
    fs.writeFileSync(destPath, voiceBuffer);

    const replica = await db.getNextPendingReplica(user.id, ctx.session.characterId);
    if (!replica) return ctx.reply('Все реплики уже озвучены! /start', { parse_mode: 'Markdown' });

    const dub = await db.getOrCreateDub(user.id, replica.id);
    session._lastVoicePath = destPath;
    session.currentDubId = dub.id;
    session.state = 'REVIEWING';

    await ctx.reply(MSG.voiceReceived);
    await ctx.reply(MSG.reviewPrompt, { parse_mode: 'Markdown', reply_markup: reviewKeyboard(dub.id, ctx.session.characterId) });
  } catch (err) {
    console.error('[voice] Error:', err);
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }
}

module.exports = { handleVoice };
