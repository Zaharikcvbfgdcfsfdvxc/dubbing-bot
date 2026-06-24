const { InlineKeyboard } = require('grammy');
const db = require('../../db/index');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PREVIEW_DEFAULT = 3;

async function handleAdminCommand(ctx) {
  const parts = ctx.message.text.split(/\s+/);
  const password = parts[1] || '';
  if (password !== ADMIN_PASSWORD) return ctx.reply('❌ Неверный пароль.');

  ctx.session.isAdmin = true;
  ctx.session.state = 'ADMIN_MENU';

  const kb = new InlineKeyboard()
    .text('📋 Список персонажей', 'admin:list').row()
    .text('👤 Назначить пользователя', 'admin:assign_menu').row()
    .text('🔓 Снять назначение', 'admin:unassign_menu').row()
    .text('🚪 Выйти из админки', 'admin:exit');
  return ctx.reply('🔐 *Админ-панель*', { parse_mode: 'Markdown', reply_markup: kb });
}

async function handleAdminCallback(ctx) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();
  if (!ctx.session.isAdmin) return ctx.reply('❌ Доступ запрещён. /admin <пароль>.');

  if (data === 'admin:exit') {
    ctx.session.isAdmin = false; ctx.session.state = 'IDLE';
    ctx.session._adminAction = ctx.session._adminCharId = null;
    return ctx.reply('🚪 Вышел из админ-панели.');
  }
  if (data === 'admin:list') return showList(ctx);
  if (data === 'admin:assign_menu') return showAssignMenu(ctx);
  if (data === 'admin:unassign_menu') return showUnassignMenu(ctx);
  if (data.startsWith('admin:assign:')) return startAssign(ctx, parseInt(data.split(':')[2]));
  if (data.startsWith('admin:unassign:')) return doUnassign(ctx, parseInt(data.split(':')[2]));
  if (data === 'admin:back') return showMainMenu(ctx);
}

async function showMainMenu(ctx) {
  ctx.session._adminAction = ctx.session._adminCharId = null;
  const kb = new InlineKeyboard()
    .text('📋 Список персонажей', 'admin:list').row()
    .text('👤 Назначить пользователя', 'admin:assign_menu').row()
    .text('🔓 Снять назначение', 'admin:unassign_menu').row()
    .text('🚪 Выйти из админки', 'admin:exit');
  return ctx.reply('🔐 *Админ-панель*', { parse_mode: 'Markdown', reply_markup: kb });
}

async function showList(ctx) {
  const items = await db.getAllCharactersWithAssignments();
  if (!items.length) return ctx.reply('Нет персонажей.', { reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
  let text = '📋 *Персонажи:*\n\n';
  for (const c of items) {
    const a = c.assigned_username ? `@${c.assigned_username}` : (c.assigned_telegram_id ? `ID ${c.assigned_telegram_id}` : '—');
    text += `🎭 *${c.project_name} / ${c.name}*\n   Назначен: ${a}\n   Лимит: ${c.preview_limit || 'нет'}\n\n`;
  }
  return ctx.reply(text, { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
}

async function showAssignMenu(ctx) {
  const items = await db.getAllCharactersWithAssignments();
  const kb = new InlineKeyboard();
  for (const c of items) kb.text(`${c.project_name}/${c.name} [${c.assigned_username || '—'}]`, `admin:assign:${c.id}`).row();
  kb.text('↩️ Назад', 'admin:back');
  return ctx.reply('Выберите персонажа:', { reply_markup: kb });
}

async function startAssign(ctx, charId) {
  ctx.session._adminAction = 'assign'; ctx.session._adminCharId = charId;
  const ch = await db.getAssignmentByCharacter(charId);
  return ctx.reply(`👤 Назначение на *${ch.project_name || ''} / ${ch.name}*\nВведите Telegram ID или @username:`,
    { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('↩️ Отмена', 'admin:back') });
}

async function doAssign(ctx, input) {
  const charId = ctx.session._adminCharId;
  ctx.session._adminAction = ctx.session._adminCharId = null;
  let telegramId;
  if (input.startsWith('@')) {
    const user = await db.getUserByUsername(input.slice(1));
    if (!user) return ctx.reply('❌ @' + input.slice(1) + ' не найден. Сначала отправьте /start боту.', { reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
    telegramId = user.telegram_id;
  } else {
    telegramId = parseInt(input);
    if (isNaN(telegramId)) return ctx.reply('❌ Введите ID или @username.', { reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
  }
  await db.assignUserToCharacter(charId, telegramId);
  await db.setPreviewLimit(charId, PREVIEW_DEFAULT);
  const ch = await db.getAssignmentByCharacter(charId);
  return ctx.reply(`✅ *${ch.name}* → @${ch.assigned_username || telegramId}\nЛимит: ${PREVIEW_DEFAULT}`, { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
}

async function showUnassignMenu(ctx) {
  const items = await db.getAllCharactersWithAssignments();
  const assigned = items.filter(c => c.assigned_telegram_id);
  if (!assigned.length) return ctx.reply('Нет назначенных.', { reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
  const kb = new InlineKeyboard();
  for (const c of assigned) kb.text(`${c.project_name}/${c.name} ← @${c.assigned_username}`, `admin:unassign:${c.id}`).row();
  kb.text('↩️ Назад', 'admin:back');
  return ctx.reply('Снять назначение:', { reply_markup: kb });
}

async function doUnassign(ctx, charId) {
  const ch = await db.getAssignmentByCharacter(charId);
  await db.unassignCharacter(charId);
  await db.setPreviewLimit(charId, 0);
  return ctx.reply(`✅ Снято с *${ch.name}*`, { parse_mode: 'Markdown', reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') });
}

async function handleAdminMessage(ctx, next) {
  const session = ctx.session;
  if (!session.isAdmin) return next();
  const text = ctx.message.text.trim();
  if (session._adminAction === 'assign' && session._adminCharId) return doAssign(ctx, text);
  return next();
}

module.exports = { handleAdminCommand, handleAdminCallback, handleAdminMessage };
