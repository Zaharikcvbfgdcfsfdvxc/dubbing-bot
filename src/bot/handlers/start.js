const db = require('../../db/index');
const MSG = require('../messages');
const { projectListKeyboard, backToProjectsKeyboard } = require('../keyboards');

async function handleStart(ctx) {
  const user = ctx.from;
  await db.upsertUser(user.id, user.username || null, user.first_name || null, user.last_name || null);

  ctx.session.state = 'SELECTING_PROJECT';
  ctx.session.projectId = null;
  ctx.session.characterId = null;
  ctx.session.currentDubId = null;

  const projects = await db.getAllProjects();

  if (projects.length === 0) {
    return ctx.reply(MSG.noProjects, { parse_mode: 'Markdown' });
  }

  return ctx.reply(MSG.welcome, { parse_mode: 'Markdown', reply_markup: projectListKeyboard(projects) });
}

async function handleRescan(ctx) {
  const scanner = require('../scanner');
  await ctx.reply(MSG.rescanning, { parse_mode: 'Markdown' });
  const stats = await scanner.scanDataDir();
  return ctx.reply(MSG.rescanDone(stats), { parse_mode: 'Markdown' });
}

async function handleStats(ctx) {
  const stats = await db.getStats();
  return ctx.reply(MSG.stats(stats), { parse_mode: 'Markdown' });
}

async function handleHelp(ctx) {
  return ctx.reply(
    '🎙️ *Dubbing Bot* — инструмент для озвучки реплик.\n\n' +
    '1. Выберите проект\n2. Выберите персонажа\n3. Получите реплику — прослушайте оригинал\n' +
    '4. Отправьте голосовое сообщение с дубляжом\n5. Подтвердите отправку\n\n' +
    'Команды:\n/start — начать заново\n/upload — загрузить проект (ZIP)\n' +
    '/rescan — пересканировать data/\n/stats — статистика\n/help — справка',
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleStart, handleRescan, handleStats, handleHelp };
