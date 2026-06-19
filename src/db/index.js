const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'dubbing.db');

let db;

function getDb() {
  if (!db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      folder_path TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS replicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      transcript TEXT DEFAULT '',
      translation TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS user_dubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      replica_id INTEGER NOT NULL REFERENCES replicas(id) ON DELETE CASCADE,
      audio_path TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, replica_id)
    );
  `);
}

// --- User queries ---

function upsertUser(telegramId, username, firstName, lastName) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, last_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = COALESCE(?, username),
      first_name = COALESCE(?, first_name),
      last_name = COALESCE(?, last_name)
  `);
  return stmt.run(telegramId, username, firstName, lastName, username, firstName, lastName);
}

function getUserByTelegramId(telegramId) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
}

// --- Project queries ---

function getAllProjects() {
  const db = getDb();
  return db.prepare('SELECT * FROM projects ORDER BY name').all();
}

function getProjectById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function upsertProject(name, folderPath) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO projects (name, folder_path) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET folder_path = excluded.folder_path
  `).run(name, folderPath);
}

// --- Character queries ---

function getCharactersByProject(projectId) {
  const db = getDb();
  return db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY name').all(projectId);
}

function getCharacterById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
}

function upsertCharacter(projectId, name, folderPath) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO characters (project_id, name, folder_path) VALUES (?, ?, ?)
    ON CONFLICT(project_id, name) DO UPDATE SET folder_path = excluded.folder_path
  `).run(projectId, name, folderPath);
}

// --- Replica queries ---

function getReplicasByCharacter(characterId) {
  const db = getDb();
  return db.prepare('SELECT * FROM replicas WHERE character_id = ? ORDER BY sort_order, filename').all(characterId);
}

function getReplicaById(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM replicas WHERE id = ?').get(id);
}

function upsertReplica(characterId, filename, transcript, translation, filePath, sortOrder) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT id FROM replicas WHERE character_id = ? AND filename = ?'
  ).get(characterId, filename);

  if (existing) {
    db.prepare(`
      UPDATE replicas SET transcript = ?, translation = ?, file_path = ?, sort_order = ?
      WHERE id = ?
    `).run(transcript, translation, filePath, sortOrder, existing.id);
    return existing.id;
  } else {
    return db.prepare(`
      INSERT INTO replicas (character_id, filename, transcript, translation, file_path, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(characterId, filename, transcript, translation, filePath, sortOrder).lastInsertRowid;
  }
}

// --- User dubs queries ---

function getOrCreateDub(userId, replicaId) {
  const db = getDb();
  const existing = db.prepare(
    'SELECT * FROM user_dubs WHERE user_id = ? AND replica_id = ?'
  ).get(userId, replicaId);
  if (existing) return existing;

  db.prepare(
    'INSERT INTO user_dubs (user_id, replica_id, status) VALUES (?, ?, ?)'
  ).run(userId, replicaId, 'pending');
  return db.prepare(
    'SELECT * FROM user_dubs WHERE user_id = ? AND replica_id = ?'
  ).get(userId, replicaId);
}

function submitDub(dubId, audioPath) {
  const db = getDb();
  return db.prepare(`
    UPDATE user_dubs SET status = 'submitted', audio_path = ?, created_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(audioPath, dubId);
}

function discardDub(dubId) {
  const db = getDb();
  return db.prepare(`
    UPDATE user_dubs SET status = 'pending', audio_path = NULL WHERE id = ?
  `).run(dubId);
}

function getNextPendingReplica(userId, characterId) {
  const db = getDb();
  return db.prepare(`
    SELECT r.* FROM replicas r
    WHERE r.character_id = ?
      AND r.id NOT IN (
        SELECT replica_id FROM user_dubs
        WHERE user_id = ? AND status = 'submitted'
      )
    ORDER BY r.sort_order, r.filename
    LIMIT 1
  `).get(characterId, userId);
}

function getPendingCount(userId, characterId) {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM replicas r
    WHERE r.character_id = ?
      AND r.id NOT IN (
        SELECT replica_id FROM user_dubs
        WHERE user_id = ? AND status = 'submitted'
      )
  `).get(characterId, userId);
  return result ? result.count : 0;
}

function getSubmittedCount(userId, characterId) {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM user_dubs
    WHERE user_id = ? AND replica_id IN (
      SELECT id FROM replicas WHERE character_id = ?
    ) AND status = 'submitted'
  `).get(userId, characterId);
  return result ? result.count : 0;
}

function getTotalReplicasCount(characterId) {
  const db = getDb();
  const result = db.prepare(
    'SELECT COUNT(*) as count FROM replicas WHERE character_id = ?'
  ).get(characterId);
  return result ? result.count : 0;
}

function clearProjectData() {
  const db = getDb();
  db.exec('DELETE FROM user_dubs');
  db.exec('DELETE FROM replicas');
  db.exec('DELETE FROM characters');
  db.exec('DELETE FROM projects');
}

// --- Stats ---

function getStats() {
  const db = getDb();
  return {
    users: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
    projects: db.prepare('SELECT COUNT(*) as count FROM projects').get().count,
    characters: db.prepare('SELECT COUNT(*) as count FROM characters').get().count,
    replicas: db.prepare('SELECT COUNT(*) as count FROM replicas').get().count,
    submittedDubs: db.prepare("SELECT COUNT(*) as count FROM user_dubs WHERE status = 'submitted'").get().count,
  };
}

module.exports = {
  getDb,
  upsertUser,
  getUserByTelegramId,
  getAllProjects,
  getProjectById,
  upsertProject,
  getCharactersByProject,
  getCharacterById,
  upsertCharacter,
  getReplicasByCharacter,
  getReplicaById,
  upsertReplica,
  getOrCreateDub,
  submitDub,
  discardDub,
  getNextPendingReplica,
  getPendingCount,
  getSubmittedCount,
  getTotalReplicasCount,
  clearProjectData,
  getStats,
};
