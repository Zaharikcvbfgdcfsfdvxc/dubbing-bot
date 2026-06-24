const fs = require('fs');
const { InputFile } = require('grammy');
const db = require('../../db/index');
const MSG = require('../messages');
const { handleCancelUpload } = require('./upload');
const { projectListKeyboard, characterListKeyboard, reviewKeyboard, dubbingKeyboard } = require('../keyboards');

async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery();
  try {
    if (data === 'back_to_projects') return handleBackToProjects(ctx);
    if (data === 'back_to_characters') return handleBackToCharacters(ctx);
    if (data.startsWith('back_to_char_from_dub:')) {
      ctx.session.characterId = parseInt(data.split(':')[1]);
      return handleBackToCharacters(ctx);
    }
    if (data.startsWith('project:')) return handleProjectSelect(ctx, parseInt(data.split(':')[1]));
    if (data.startsWith('character:')) return handleCharacterSelect(ctx, parseInt(data.split(':')[1]));
    if (data.startsWith('submit:')) {
      const [, dubId, charId] = data.split(':');
      return handleSubmit(ctx, parseInt(dubId), parseInt(charId));
    }
    if (data.startsWith('rerecord:')) {
      const [, dubId, charId] = data.split(':');
      return handleRerecord(ctx, parseInt(dubId), parseInt(charId));
    }
    if (data === 'cancel_upload') return handleCancelUpload(ctx);
  } catch (err) {
    console.error('[callback] Error:', err);
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }
}

async function handleBackToProjects(ctx) {
  ctx.session.state = 'SELECTING_PROJECT';
  ctx.session.projectId = ctx.session.characterId = ctx.session.currentDubId = null;
  const projects = await db.getAllProjects();
  if (!projects.length) return ctx.reply(MSG.backToProjects + '\n\n' + MSG.noProjects, { parse_mode: 'Markdown' });
  return ctx.reply(MSG.backToProjects, { parse_mode: 'Markdown', reply_markup: projectListKeyboard(projects) });
}

async function handleBackToCharacters(ctx) {
  ctx.session.state = 'SELECTING_CHARACTER';
  ctx.session.characterId = ctx.session.currentDubId = null;
  const projectId = ctx.session.projectId;
  if (!projectId) return handleBackToProjects(ctx);
  const project = await db.getProjectById(projectId);
  const characters = await db.getCharactersByProject(projectId);
  if (!characters.length) return ctx.reply(`🎭 *${project.name}*\n\n` + MSG.noCharacters, { parse_mode: 'Markdown', reply_markup: characterListKeyboard([]) });
  return ctx.reply(MSG.selectCharacter, { parse_mode: 'Markdown', reply_markup: characterListKeyboard(characters) });
}

async function handleProjectSelect(ctx, projectId) {
  ctx.session.projectId = projectId;
  ctx.session.state = 'SELECTING_CHARACTER';
  const project = await db.getProjectById(projectId);
  if (!project) return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  const characters = await db.getCharactersByProject(projectId);
  if (!characters.length) return ctx.reply(`🎭 *${project.name}*\n\n` + MSG.noCharacters, { parse_mode: 'Markdown', reply_markup: characterListKeyboard([]) });
  return ctx.reply(`📁 *${project.name}*\n\n` + MSG.selectCharacter, { parse_mode: 'Markdown', reply_markup: characterListKeyboard(characters) });
}

async function handleCharacterSelect(ctx, characterId) {
  ctx.session.characterId = characterId;
  ctx.session.state = 'DUBBING';
  const character = await db.getCharacterById(characterId);
  if (!character) return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  return sendNextReplica(ctx, character);
}

async function sendNextReplica(ctx, character) {
  const userId = await db.getUserByTelegramId(ctx.from.id);
  if (!userId) return ctx.reply(MSG.error, { parse_mode: 'Markdown' });

  const charInfo = await db.getAssignmentByCharacter(character.id);
  if (charInfo && charInfo.assigned_telegram_id && charInfo.preview_limit > 0) {
    if (charInfo.assigned_telegram_id !== ctx.from.id) {
      const submitted = await db.getSubmittedCount(userId.id, character.id);
      if (submitted >= charInfo.preview_limit) {
        ctx.session.state = 'SELECTING_CHARACTER';
        ctx.session.characterId = null;
        return ctx.reply(
          `🔒 *${character.name}* — только для назначенного пользователя.\nВы можете озвучить первые ${charInfo.preview_limit} реплик (уже: ${submitted}).\nВыберите другого:`,
          { parse_mode: 'Markdown', reply_markup: characterListKeyboard(await db.getCharactersByProject(ctx.session.projectId)) }
        );
      }
    }
  }

  const replica = await db.getNextPendingReplica(userId.id, character.id);
  if (!replica) {
    ctx.session.state = 'SELECTING_CHARACTER';
    ctx.session.characterId = null;
    return ctx.reply(`🎭 *${character.name}*\n\n` + MSG.allDone, {
      parse_mode: 'Markdown', reply_markup: characterListKeyboard(await db.getCharactersByProject(ctx.session.projectId))
    });
  }

  try {
    await ctx.replyWithAudio(new InputFile(replica.file_path), { title: replica.filename, performer: character.name });
  } catch (err) {
    console.error('[callback] Audio send failed:', err.message);
    await ctx.reply(`⚠️ Не удалось отправить аудио: ${replica.filename}`);
  }

  const submitted = await db.getSubmittedCount(userId.id, character.id);
  const total = await db.getTotalReplicasCount(character.id);
  await ctx.reply(MSG.replicaHeader(replica.media_id || replica.filename, replica.transcript, replica.translation, submitted, total, replica.duration), {
    parse_mode: 'Markdown', reply_markup: dubbingKeyboard(character.id)
  });
  await ctx.reply(MSG.waitingForVoice);
}

async function handleSubmit(ctx, dubId, characterId) {
  ctx.session.state = 'DUBBING';
  if (!ctx.session._lastVoicePath) {
    ctx.session.currentDubId = null;
    return ctx.reply('❌ Запись не найдена. Отправьте голосовое заново.', { parse_mode: 'Markdown' });
  }
  await db.submitDub(dubId, ctx.session._lastVoicePath);
  ctx.session.currentDubId = ctx.session._lastVoicePath = null;
  const character = await db.getCharacterById(characterId);
  if (!character) return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  await ctx.reply(MSG.submitted);
  return sendNextReplica(ctx, character);
}

async function handleRerecord(ctx, dubId, characterId) {
  ctx.session.state = 'DUBBING';
  ctx.session.currentDubId = null;
  const dub = await db.getDubById(dubId);
  if (dub && dub.audio_path && fs.existsSync(dub.audio_path)) {
    try { fs.unlinkSync(dub.audio_path); } catch {}
  }
  await db.discardDub(dubId);
  await ctx.reply(MSG.discarded);
}

module.exports = { handleCallback, sendNextReplica };
