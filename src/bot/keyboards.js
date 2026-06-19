const { InlineKeyboard } = require('grammy');

/**
 * Build a keyboard with project selection buttons.
 * @param {Array<{id: number, name: string}>} projects
 */
function projectListKeyboard(projects) {
  const kb = new InlineKeyboard();
  projects.forEach((p, i) => {
    kb.text(p.name, `project:${p.id}`);
    // Max 2 buttons per row
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

/**
 * Build a keyboard with character selection buttons + back button.
 * @param {Array<{id: number, name: string}>} characters
 * @param {number} projectId
 */
function characterListKeyboard(characters) {
  const kb = new InlineKeyboard();
  characters.forEach((c, i) => {
    kb.text(c.name, `character:${c.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row();
  kb.text('↩️ Назад к проектам', 'back_to_projects');
  return kb;
}

/**
 * Review keyboard after user sends voice.
 * @param {number} dubId
 */
function reviewKeyboard(dubId, characterId) {
  return new InlineKeyboard()
    .text('🔄 Перезаписать', `rerecord:${dubId}:${characterId}`)
    .text('✅ Отправить', `submit:${dubId}:${characterId}`)
    .row()
    .text('↩️ Назад к персонажам', 'back_to_characters');
}

/**
 * Navigation keyboard during dubbing.
 */
function dubbingKeyboard(characterId) {
  return new InlineKeyboard()
    .text('↩️ Назад к персонажам', `back_to_char_from_dub:${characterId}`);
}

/**
 * Simple "back to projects" keyboard.
 */
function backToProjectsKeyboard() {
  return new InlineKeyboard()
    .text('↩️ Назад к проектам', 'back_to_projects');
}

module.exports = {
  projectListKeyboard,
  characterListKeyboard,
  reviewKeyboard,
  dubbingKeyboard,
  backToProjectsKeyboard,
};
