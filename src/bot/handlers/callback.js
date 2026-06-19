const fs = require('fs');
const { InputFile } = require('grammy');
const db = require('../db/index');
const MSG = require('../messages');
const { handleCancelUpload } = require('./upload');
const {
  projectListKeyboard,
  characterListKeyboard,
  reviewKeyboard,
  dubbingKeyboard,
} = require('../keyboards');

/**
 * Handle all inline keyboard callbacks.
 * Callback data formats:
 *   project:{id}
 *   character:{id}
 *   back_to_projects
 *   back_to_characters
 *   cancel_upload
 *   submit:{dubId}:{characterId}
 *   rerecord:{dubId}:{characterId}
 */
async function handleCallback(ctx) {
  const data = ctx.callbackQuery.data;
  await ctx.answerCallbackQuery(); // Always acknowledge

  try {
    if (data === 'back_to_projects') {
      return handleBackToProjects(ctx);
    }

    if (data === 'back_to_characters') {
      return handleBackToCharacters(ctx);
    }

    if (data.startsWith('back_to_char_from_dub:')) {
      const characterId = parseInt(data.split(':')[1]);
      ctx.session.characterId = characterId;
      return handleBackToCharacters(ctx);
    }

    if (data.startsWith('project:')) {
      const projectId = parseInt(data.split(':')[1]);
      return handleProjectSelect(ctx, projectId);
    }

    if (data.startsWith('character:')) {
      const characterId = parseInt(data.split(':')[1]);
      return handleCharacterSelect(ctx, characterId);
    }

    if (data.startsWith('submit:')) {
      const [, dubIdStr, characterIdStr] = data.split(':');
      return handleSubmit(ctx, parseInt(dubIdStr), parseInt(characterIdStr));
    }

    if (data.startsWith('rerecord:')) {
      const [, dubIdStr, characterIdStr] = data.split(':');
      return handleRerecord(ctx, parseInt(dubIdStr), parseInt(characterIdStr));
    }

    if (data === 'cancel_upload') {
      return handleCancelUpload(ctx);
    }

  } catch (err) {
    console.error('[callback] Error:', err);
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }
}

// --- Navigation handlers ---

async function handleBackToProjects(ctx) {
  ctx.session.state = 'SELECTING_PROJECT';
  ctx.session.projectId = null;
  ctx.session.characterId = null;
  ctx.session.currentDubId = null;

  const projects = db.getAllProjects();
  if (projects.length === 0) {
    return ctx.reply(MSG.backToProjects + '\n\n' + MSG.noProjects, { parse_mode: 'Markdown' });
  }

  return ctx.reply(MSG.backToProjects, {
    parse_mode: 'Markdown',
    reply_markup: projectListKeyboard(projects),
  });
}

async function handleBackToCharacters(ctx) {
  ctx.session.state = 'SELECTING_CHARACTER';
  ctx.session.characterId = null;
  ctx.session.currentDubId = null;

  const projectId = ctx.session.projectId;
  if (!projectId) {
    return handleBackToProjects(ctx);
  }

  const project = db.getProjectById(projectId);
  const characters = db.getCharactersByProject(projectId);

  if (characters.length === 0) {
    return ctx.reply(`🎭 *${project.name}*\n\n` + MSG.noCharacters, {
      parse_mode: 'Markdown',
      reply_markup: characterListKeyboard([]),
    });
  }

  return ctx.reply(MSG.selectCharacter, {
    parse_mode: 'Markdown',
    reply_markup: characterListKeyboard(characters),
  });
}

// --- Selection handlers ---

async function handleProjectSelect(ctx, projectId) {
  ctx.session.projectId = projectId;
  ctx.session.state = 'SELECTING_CHARACTER';

  const project = db.getProjectById(projectId);
  if (!project) {
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }

  const characters = db.getCharactersByProject(projectId);

  if (characters.length === 0) {
    return ctx.reply(`🎭 *${project.name}*\n\n` + MSG.noCharacters, {
      parse_mode: 'Markdown',
      reply_markup: characterListKeyboard([]),
    });
  }

  return ctx.reply(`📁 *${project.name}*\n\n` + MSG.selectCharacter, {
    parse_mode: 'Markdown',
    reply_markup: characterListKeyboard(characters),
  });
}

async function handleCharacterSelect(ctx, characterId) {
  ctx.session.characterId = characterId;
  ctx.session.state = 'DUBBING';

  const character = db.getCharacterById(characterId);
  if (!character) {
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }

  return sendNextReplica(ctx, character);
}

// --- Replica sending ---

async function sendNextReplica(ctx, character) {
  const userId = db.getUserByTelegramId(ctx.from.id);
  if (!userId) return ctx.reply(MSG.error, { parse_mode: 'Markdown' });

  const replica = db.getNextPendingReplica(userId.id, character.id);

  if (!replica) {
    // All done for this character
    const total = db.getTotalReplicasCount(character.id);
    ctx.session.state = 'SELECTING_CHARACTER';
    ctx.session.characterId = null;

    return ctx.reply(
      `🎭 *${character.name}*\n\n` + MSG.allDone,
      {
        parse_mode: 'Markdown',
        reply_markup: characterListKeyboard(db.getCharactersByProject(ctx.session.projectId)),
      }
    );
  }

  // Send the audio file
  try {
    await ctx.replyWithAudio(
      new InputFile(replica.file_path),
      {
        title: replica.filename,
        performer: character.name,
      }
    );
  } catch (err) {
    console.error('[callback] Failed to send audio:', err.message);
    await ctx.reply(`⚠️ Не удалось отправить аудио: ${replica.filename}`);
  }

  // Send the text with transcript and translation
  const submitted = db.getSubmittedCount(userId.id, character.id);
  const total = db.getTotalReplicasCount(character.id);

  await ctx.reply(
    MSG.replicaHeader(replica.transcript, replica.translation, submitted, total),
    {
      parse_mode: 'Markdown',
      reply_markup: dubbingKeyboard(character.id),
    }
  );

  await ctx.reply(MSG.waitingForVoice);
}

// --- Review handlers ---

async function handleSubmit(ctx, dubId, characterId) {
  ctx.session.state = 'DUBBING';

  // Check that we have a voice recording
  if (!ctx.session._lastVoicePath) {
    ctx.session.currentDubId = null;
    return ctx.reply('❌ Запись не найдена. Отправь голосовое сообщение заново.', { parse_mode: 'Markdown' });
  }

  // Submit the dub
  db.submitDub(dubId, ctx.session._lastVoicePath);
  ctx.session.currentDubId = null;
  ctx.session._lastVoicePath = null;

  const character = db.getCharacterById(characterId);
  if (!character) {
    return ctx.reply(MSG.error, { parse_mode: 'Markdown' });
  }

  await ctx.reply(MSG.submitted);

  // Send next replica
  return sendNextReplica(ctx, character);
}

async function handleRerecord(ctx, dubId, characterId) {
  ctx.session.state = 'DUBBING';
  ctx.session.currentDubId = null;

  // Delete old recording file if exists
  const dub = db.getDb().prepare('SELECT * FROM user_dubs WHERE id = ?').get(dubId);
  if (dub && dub.audio_path && fs.existsSync(dub.audio_path)) {
    try { fs.unlinkSync(dub.audio_path); } catch {}
  }

  // Reset dub status
  db.discardDub(dubId);

  await ctx.reply(MSG.discarded);
}

module.exports = { handleCallback, sendNextReplica };
