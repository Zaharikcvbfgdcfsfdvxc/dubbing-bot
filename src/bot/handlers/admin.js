const { InlineKeyboard } = require('grammy');
const db = require('../../db/index');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const PREVIEW_DEFAULT = 3; // default preview limit for assigned characters

/**
 * Handle /admin command.
 */
async function handleAdminCommand(ctx) {
  const parts = ctx.message.text.split(/\s+/);
  const password = parts[1] || '';

  if (password !== ADMIN_PASSWORD) {
    return ctx.reply('❌ Неверный пароль.');
  }

  ctx.session.isAdmin = true;
  ctx.session.state = 'ADMIN_MENU';

  const keyboard = new InlineKeyboard()
    .text('📋 Список персонажей', 'admin:list').row()
    .text('👤 Назначить пользователя', 'admin:assign_menu').row()
    .text('🔓 Снять назначение', 'admin:unassign_menu').row()
    .text('🚪 Выйти из админки', 'admin:exit');

  return ctx.reply('🔐 *Админ-панель*\n\nВыбери действие:', {
    parse_mode: 'Markdown',
    reply_markup: keyboard,
  });
}

/**
 * Handle admin callback queries.
 */
async function handleAdminCallback(ctx) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();

  if (!ctx.session.isAdmin) {
    return ctx.reply('❌ Доступ запрещён. Используй /admin <пароль>.');
  }

  if (data === 'admin:exit') {
    ctx.session.isAdmin = false;
    ctx.session.state = 'IDLE';
    ctx.session._adminAction = null;
    ctx.session._adminCharId = null;
    return ctx.reply('🚪 Вышел из админ-панели. /admin — войти заново.');
  }

  if (data === 'admin:list') {
    return showCharacterList(ctx);
  }

  if (data === 'admin:assign_menu') {
    return showAssignMenu(ctx);
  }

  if (data === 'admin:unassign_menu') {
    return showUnassignMenu(ctx);
  }

  if (data.startsWith('admin:assign:')) {
    const charId = parseInt(data.split(':')[2]);
    return startAssign(ctx, charId);
  }

  if (data.startsWith('admin:unassign:')) {
    const charId = parseInt(data.split(':')[2]);
    return doUnassign(ctx, charId);
  }

  if (data.startsWith('admin:setlimit:')) {
    const charId = parseInt(data.split(':')[2]);
    return startSetLimit(ctx, charId);
  }

  if (data === 'admin:back') {
    ctx.session._adminAction = null;
    ctx.session._adminCharId = null;
    const keyboard = new InlineKeyboard()
      .text('📋 Список персонажей', 'admin:list').row()
      .text('👤 Назначить пользователя', 'admin:assign_menu').row()
      .text('🔓 Снять назначение', 'admin:unassign_menu').row()
      .text('🚪 Выйти из админки', 'admin:exit');
    return ctx.reply('🔐 *Админ-панель*', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }
}

/**
 * Handle text messages during admin assign/setlimit flows.
 */
async function handleAdminMessage(ctx, next) {
  const session = ctx.session;
  if (!session.isAdmin) return next();

  const text = ctx.message.text.trim();

  if (session._adminAction === 'assign' && session._adminCharId) {
    return doAssign(ctx, text);
  }

  if (session._adminAction === 'setlimit' && session._adminCharId) {
    return doSetLimit(ctx, text);
  }

  return next();
}

// --- Show lists ---

async function showCharacterList(ctx) {
  const items = db.getAllCharactersWithAssignments();
  if (items.length === 0) {
    return ctx.reply('Нет персонажей.', {
      reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
    });
  }

  let text = '📋 *Персонажи:*\n\n';
  for (const c of items) {
    const assigned = c.assigned_username
      ? `@${c.assigned_username}`
      : (c.assigned_telegram_id ? `ID ${c.assigned_telegram_id}` : '—');
    text += `🎭 *${c.project_name} / ${c.name}*\n`;
    text += `   Назначен: ${assigned}\n`;
    text += `   Превью-лимит: ${c.preview_limit || 'нет'}\n\n`;
  }

  return ctx.reply(text, {
    parse_mode: 'Markdown',
    reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
  });
}

// --- Assign flow ---

async function showAssignMenu(ctx) {
  const items = db.getAllCharactersWithAssignments();
  const kb = new InlineKeyboard();

  for (const c of items) {
    const label = `${c.project_name}/${c.name} [${c.assigned_username || '—'}]`;
    kb.text(label, `admin:assign:${c.id}`).row();
  }
  kb.text('↩️ Назад', 'admin:back');

  return ctx.reply('Выбери персонажа для назначения:', { reply_markup: kb });
}

async function startAssign(ctx, charId) {
  ctx.session._adminAction = 'assign';
  ctx.session._adminCharId = charId;

  const ch = db.getAssignmentByCharacter(charId);
  return ctx.reply(
    `👤 Назначение пользователя на *${ch.project_name || ''} / ${ch.name}*\n\n` +
    `Введи Telegram ID пользователя или @username:`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('↩️ Отмена', 'admin:back'),
    }
  );
}

async function doAssign(ctx, input) {
  const charId = ctx.session._adminCharId;
  ctx.session._adminAction = null;
  ctx.session._adminCharId = null;

  // Parse: @username or numeric ID
  let telegramId = null;
  if (input.startsWith('@')) {
    // Look up user by username
    const username = input.slice(1);
    const user = db.getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (user) {
      telegramId = user.telegram_id;
    } else {
      return ctx.reply(
        `❌ Пользователь @${username} не найден в БД.\nОн должен сначала отправить /start боту.`,
        { reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') }
      );
    }
  } else {
    telegramId = parseInt(input);
    if (isNaN(telegramId)) {
      return ctx.reply(
        '❌ Введи числовой Telegram ID или @username.',
        { reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back') }
      );
    }
  }

  db.assignUserToCharacter(charId, telegramId);
  db.setPreviewLimit(charId, PREVIEW_DEFAULT);
  const ch = db.getAssignmentByCharacter(charId);

  return ctx.reply(
    `✅ *${ch.name}* назначен на @${ch.assigned_username || telegramId}\n` +
    `Превью-лимит для остальных: ${PREVIEW_DEFAULT} реплик`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
    }
  );
}

// --- Unassign flow ---

async function showUnassignMenu(ctx) {
  const items = db.getAllCharactersWithAssignments();
  const assigned = items.filter(c => c.assigned_telegram_id);

  if (assigned.length === 0) {
    return ctx.reply('Нет назначенных персонажей.', {
      reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
    });
  }

  const kb = new InlineKeyboard();
  for (const c of assigned) {
    kb.text(`${c.project_name}/${c.name} ← @${c.assigned_username}`, `admin:unassign:${c.id}`).row();
  }
  kb.text('↩️ Назад', 'admin:back');

  return ctx.reply('Выбери персонажа для снятия назначения:', { reply_markup: kb });
}

async function doUnassign(ctx, charId) {
  const ch = db.getAssignmentByCharacter(charId);
  db.unassignCharacter(charId);
  db.setPreviewLimit(charId, 0);

  return ctx.reply(
    `✅ Назначение снято с *${ch.name}*`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
    }
  );
}

// --- Set limit ---

async function startSetLimit(ctx, charId) {
  ctx.session._adminAction = 'setlimit';
  ctx.session._adminCharId = charId;

  const ch = db.getAssignmentByCharacter(charId);
  return ctx.reply(
    `🔢 Установи превью-лимит для *${ch.name}*\n\n` +
    `Введи число (0 = без ограничений):`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('↩️ Отмена', 'admin:back'),
    }
  );
}

async function doSetLimit(ctx, input) {
  const charId = ctx.session._adminCharId;
  ctx.session._adminAction = null;
  ctx.session._adminCharId = null;

  const limit = parseInt(input);
  if (isNaN(limit) || limit < 0) {
    return ctx.reply('❌ Введи число >= 0.', {
      reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
    });
  }

  db.setPreviewLimit(charId, limit);
  const ch = db.getAssignmentByCharacter(charId);

  return ctx.reply(
    `✅ Превью-лимит для *${ch.name}*: ${limit} реплик`,
    {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard().text('↩️ Назад', 'admin:back'),
    }
  );
}

module.exports = {
  handleAdminCommand,
  handleAdminCallback,
  handleAdminMessage,
};
