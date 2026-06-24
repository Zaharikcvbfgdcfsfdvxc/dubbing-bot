// All bot messages in Russian

const MSG = {
  // Start
  welcome: '🎙️ *Добро пожаловать в Dubbing Bot!*\n\nВыберите проект для озвучки:',

  // Project selection
  selectProject: '📁 Выберите проект:',
  noProjects: '❌ Нет доступных проектов.\n\nАдминистратор должен добавить файлы в папку `data/` и выполнить `/rescan`.',

  // Character selection
  selectCharacter: '🎭 Выберите персонажа:',
  noCharacters: '❌ В этом проекте нет персонажей.',

  // Replica
  replicaHeader: (mediaId, transcript, translation, submitted, total, duration) =>
    `🎬 *Реплика #${mediaId}*\n` +
    (duration ? `⏱ Длительность: ${duration.toFixed(1)}с\n` : '') +
    `\n🇬🇧 *EN:* ${transcript}\n` +
    `🇷🇺 *RU:* ${translation}\n\n` +
    `📊 Прогресс: ${submitted}/${total}`,

  waitingForVoice: '🎤 Отправьте голосовое сообщение с дубляжом.',
  allDone: '✅ *Все реплики этого персонажа озвучены!*\n\nВыберите другого персонажа или вернитесь к проектам.',

  // Review
  voiceReceived: '✅ Голосовое получено!',
  reviewPrompt: 'Прослушайте свою запись выше ⤴️ и выберите действие:',

  // Submit
  submitted: '✅ Реплика отправлена!',
  discarded: '🗑️ Запись удалена. Отправьте новое голосовое сообщение.',

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
  error: '❌ Произошла ошибка. Попробуйте позже или начните заново командой /start.',
  noVoice: '❌ Отправьте голосовое сообщение, а не текст.',
  voiceTooBig: '❌ Голосовое сообщение слишком большое. Попробуйте записать короче.',
};

module.exports = MSG;
