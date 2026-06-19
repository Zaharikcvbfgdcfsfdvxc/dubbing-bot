const db = require('../db/index');
const MSG = require('../messages');
const { projectListKeyboard, backToProjectsKeyboard } = require('../keyboards');

/**
 * Handle /start command.
 * Shows greeting and project list.
 */
async function handleStart(ctx) {
  // Upsert user
  const user = ctx.from;
  db.upsertUser(user.id, user.username || null, user.first_name || null, user.last_name || null);

  // Clear session state
  ctx.session.state = 'SELECTING_PROJECT';
  ctx.session.projectId = null;
  ctx.session.characterId = null;
  ctx.session.currentDubId = null;

  const projects = db.getAllProjects();

  if (projects.length === 0) {
    return ctx.reply(MSG.noProjects, {
      parse_mode: 'Markdown',
      reply_markup: { remove_keyboard: true },
    });
  }

  return ctx.reply(MSG.welcome, {
    parse_mode: 'Markdown',
    reply_markup: projectListKeyboard(projects),
  });
}

/**
 * Handle /rescan command (admin).
 */
async function handleRescan(ctx) {
  const scanner = require('../scanner');
  await ctx.reply(MSG.rescanning, { parse_mode: 'Markdown' });
  const stats = scanner.scanDataDir();
  return ctx.reply(MSG.rescanDone(stats), { parse_mode: 'Markdown' });
}

/**
 * Handle /stats command (admin).
 */
async function handleStats(ctx) {
  const stats = db.getStats();
  return ctx.reply(MSG.stats(stats), { parse_mode: 'Markdown' });
}

/**
 * Handle /help command.
 */
async function handleHelp(ctx) {
  return ctx.reply(
    '🎙️ *Dubbing Bot* — инструмент для озвучки реплик.\n\n' +
    '1. Выбери проект\n' +
    '2. Выбери персонажа\n' +
    '3. Получи реплику — прослушай оригинал\n' +
    '4. Отправь голосовое сообщение с дубляжом\n' +
    '5. Подтверди отправку\n\n' +
    'Команды:\n' +
    '/start — начать заново\n' +
    '/upload — загрузить проект (ZIP)\n' +
    '/rescan — пересканировать папку data/\n' +
    '/stats — статистика\n' +
    '/help — эта справка',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleStart, handleRescan, handleStats, handleHelp };
