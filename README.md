# Dubbing Bot

Telegram-бот для озвучки реплик. Пользователь выбирает проект и персонажа, получает реплики по одной (аудио оригинала + текст перевода), отправляет голосовое сообщение с дубляжом — реплика сохраняется, приходит следующая.

## Возможности

- 🎬 Поочерёдная выдача реплик с оригинальным аудио и переводом
- 🎤 Приём дубляжа через голосовые сообщения Telegram
- ✅ Подтверждение / перезапись перед отправкой
- 📦 Загрузка проектов через ZIP прямо в боте (`/upload`)
- 💾 Прогресс пользователей хранится в SQLite
- 🐳 Docker-образ

## Структура проекта

```
src/
  index.js                     ← точка входа (запуск бота)
  bot/
    index.js                   ← ядро на grammy (сессии, middleware)
    scanner.js                 ← сканирование data/ → БД
    keyboards.js               ← inline-клавиатуры
    messages.js                ← тексты сообщений
    utils.js                   ← хелперы
    handlers/
      start.js                 ← /start, /help, /rescan, /stats
      callback.js              ← обработка inline-кнопок
      voice.js                 ← приём голосовых сообщений
      upload.js                ← /upload (загрузка ZIP)
  db/
    index.js                   ← SQLite (таблицы и запросы)
  utils/
    transcriptParser.js        ← парсер TXT-транскрипций
data/
  {project}/
    {character}/
      {media_id}/
        original.wav           ← аудио реплики
        transcript.txt         ← Оригинал: / Перевод:
        info.json              ← {media_id, character, duration}
```

## Установка

```bash
git clone https://github.com/Zaharikcvbfgdcfsfdvxc/dubbing-bot.git
cd dubbing-bot
npm install
```

## Запуск

```bash
# Задай токен бота (получить у @BotFather)
export BOT_TOKEN="123456:ABC..."
# или PowerShell:
$env:BOT_TOKEN = "123456:ABC..."

npm start
```

### Docker

```bash
docker build -t dubbing-bot .
docker run -e BOT_TOKEN="..." -v $(pwd)/data:/app/data dubbing-bot
```

## Использование

### Для озвучки

1. Отправь `/start` боту
2. Выбери проект → персонажа
3. Прослушай оригинал, прочитай текст и перевод
4. Отправь голосовое сообщение с дубляжом
5. Нажми **Отправить** (или **Перезаписать**)
6. Приходит следующая реплика

### Команды бота

| Команда | Описание |
|---------|----------|
| `/start` | Начать озвучку |
| `/upload` | Загрузить проект (ZIP-архив) |
| `/rescan` | Пересканировать папку `data/` |
| `/stats` | Статистика |
| `/admin <пароль>` | Админ-панель |
| `/help` | Справка |

### Админ-панель

`/admin <пароль>` (по умолчанию `admin123`, задаётся в `ADMIN_PASSWORD`)

- **Назначение пользователей** — привязать Telegram-пользователя к персонажу
- **Превью-лимит** — назначенный пользователь озвучивает все реплики, остальные — только первые N (по умолчанию 3)
- **Снятие назначения** — персонаж снова доступен всем

### Загрузка проекта

1. Подготовь ZIP-архив со структурой:
   ```
   ProjectName/
     CharacterName/
       {media_id}/
         original.wav
         transcript.txt
         info.json
   ```
   Или только папку персонажа — бот спросит имя проекта.
2. Отправь `/upload` боту и пришли ZIP
3. Бот распакует и проиндексирует

### Формат transcript.txt

```
Оригинал:
English text here

Перевод:
Русский текст здесь
```

## Структура данных на сервере

```
data/
  CaptainAmerica/
    Captain America/
      1005818535/
        original.wav
        transcript.txt
        info.json
```

Достаточно скопировать папки в `data/` и выполнить `/rescan`.

## Технологии

- [grammy](https://grammy.dev/) — фреймворк для Telegram Bot API
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — синхронный SQLite
- [JSZip](https://stuk.github.io/jszip/) — распаковка ZIP
- Node.js 22+

## Лицензия

MIT
