const { Bot, session } = require('grammy');
const { handleStart, handleRescan, handleStats, handleHelp } = require('./handlers/start');
const { handleCallback } = require('./handlers/callback');
const { handleVoice } = require('./handlers/voice');
const { handleUploadCommand, handleDocument, handleUploadText } = require('./handlers/upload');
const { handleAdminCommand, handleAdminCallback, handleAdminMessage } = require('./handlers/admin');
const { scanDataDir } = require('./scanner');

const BOT_TOKEN = process.env.BOT_TOKEN || '';

function createBot() {
  if (!BOT_TOKEN) {
    console.error('[bot] BOT_TOKEN environment variable is not set!');
    return { bot: null, startBot: () => {} };
  }

  const bot = new Bot(BOT_TOKEN);

  // Session configuration
  bot.use(session({
    initial: () => ({
      state: 'IDLE',
      projectId: null,
      characterId: null,
      currentDubId: null,
      _lastVoicePath: null,
      isAdmin: false,
      _adminAction: null,
      _adminCharId: null,
    }),
  }));

  // --- Command handlers ---
  bot.command('start', handleStart);
  bot.command('rescan', handleRescan);
  bot.command('stats', handleStats);
  bot.command('help', handleHelp);
  bot.command('upload', handleUploadCommand);
  bot.command('admin', handleAdminCommand);

  // --- Admin callback handler (before main to catch admin:*) ---
  bot.on('callback_query:data', (ctx, next) => {
    if (ctx.callbackQuery.data.startsWith('admin:')) {
      return handleAdminCallback(ctx);
    }
    return next();
  });

  // --- Main callback query handler (inline buttons) ---
  bot.on('callback_query:data', handleCallback);

  // --- Voice message handler ---
  bot.on('message:voice', handleVoice);

  // --- Document handler (ZIP upload) ---
  bot.on('message:document', handleDocument);

  // --- Upload text handler (project name for character ZIP) ---
  bot.on('message:text', handleUploadText);

  // --- Admin message handler (text input during assign/setlimit) ---
  bot.on('message:text', handleAdminMessage);

  // --- Fallback for non-voice messages during dubbing ---
  bot.on('message', (ctx, next) => {
    const session = ctx.session;
    if (session.state === 'DUBBING') {
      return ctx.reply(
        '🎤 Отправь голосовое сообщение (voice message), а не текст.\n\nИли начни заново: /start'
      );
    }
    return next();
  });

  // --- Error handler ---
  bot.catch((err) => {
    console.error('[bot] Unhandled error:', err.message);
    if (err.error) {
      console.error('[bot] Telegram API error:', err.error.description || err.error);
    }
  });

  // --- Startup ---
  async function startBot() {
    console.log('[bot] Starting Telegram bot (long polling)...');

    try {
      await scanDataDir();
    } catch (err) {
      console.error('[bot] Failed to scan data directory:', err.message);
    }

    bot.start({
      onStart(botInfo) {
        console.log(`[bot] Bot @${botInfo.username} is running!`);
      },
    });
  }

  return { bot, startBot };
}

module.exports = { createBot };
