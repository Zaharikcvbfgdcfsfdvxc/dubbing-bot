// All bot messages in Russian

const MSG = {
  // Start
  welcome: '🎙️ *Добро пожаловать в Dubbing Bot!*\n\nВыбери проект для озвучки:',

  // Project selection
  selectProject: '📁 Выбери проект:',
  noProjects: '❌ Нет доступных проектов.\n\nАдминистратор должен добавить файлы в папку `data/` и выполнить `/rescan`.',

  // Character selection
  selectCharacter: '🎭 Выбери персонажа:',
  noCharacters: '❌ В этом проекте нет персонажей.',

  // Replica
  replicaHeader: (transcript, translation, submitted, total) =>
    `🎬 *Реплика*\n\n` +
    `🇬🇧 *EN:* ${transcript}\n` +
    `🇷🇺 *RU:* ${translation}\n\n` +
    `📊 Прогресс: ${submitted}/${total}`,

  waitingForVoice: '🎤 Отправь голосовое сообщение с дубляжом.',
  allDone: '✅ *Все реплики этого персонажа озвучены!*\n\nВыбери другого персонажа или вернись к проектам.',

  // Review
  voiceReceived: '✅ Голосовое получено!',
  reviewPrompt: 'Прослушай свою запись выше ⤴️ и выбери действие:',

  // Submit
  submitted: '✅ Реплика отправлена!',
  discarded: '🗑️ Запись удалена. Отправь новое голосовое сообщение.',

  // Back navigation
  backToProjects: '↩️ Возвращаемся к проектам.',
  backToCharacters: '↩️ Возвращаемся к персонажам.',

  // Admin
  rescanning: '🔄 Пересканирую папку `data/`...',
  rescanDone: (stats) =>
    `✅ Сканирование завершено!\n\n` +
    `📁 Проектов: ${stats.projects}\n` +
    `🎭 Персонажей: ${stats.characters}\n` +
    `🎬 Реплик: ${stats.replicas}`,

  stats: (stats) =>
    `📊 *Статистика*\n\n` +
    `👤 Пользователей: ${stats.users}\n` +
    `📁 Проектов: ${stats.projects}\n` +
    `🎭 Персонажей: ${stats.characters}\n` +
    `🎬 Реплик: ${stats.replicas}\n` +
    `✅ Отправлено дубляжей: ${stats.submittedDubs}`,

  // Errors
  error: '❌ Произошла ошибка. Попробуй позже или начни заново командой /start.',
  noVoice: '❌ Отправь голосовое сообщение, а не текст.',
  voiceTooBig: '❌ Голосовое сообщение слишком большое. Попробуй записать короче.',
};

module.exports = MSG;
