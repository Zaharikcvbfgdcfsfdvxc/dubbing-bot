const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'dubbing.db');

let db;
let SQL; // sql.js module

// --- Helpers wrapping sql.js ---

function run(sql, params = []) {
  db.run(sql, params);
  const r = db.exec('SELECT last_insert_rowid()');
  const lastInsertRowid = r.length > 0 && r[0].values.length > 0 ? r[0].values[0][0] : null;
  return { lastInsertRowid, changes: db.getRowsModified() };
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row;
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
  }
  stmt.free();
  return row;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const row = {};
    for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
    rows.push(row);
  }
  stmt.free();
  return rows;
}

function exec(sql) {
  return db.exec(sql);
}

// --- Persistence ---

function saveDb() {
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

// --- Init ---

async function initDb() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  exec('PRAGMA foreign_keys = ON');

  exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      folder_path TEXT NOT NULL
    )
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      assigned_telegram_id INTEGER DEFAULT NULL,
      preview_limit INTEGER DEFAULT 0,
      UNIQUE(project_id, name)
    )
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS replicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      media_id TEXT DEFAULT '',
      filename TEXT NOT NULL,
      transcript TEXT DEFAULT '',
      translation TEXT DEFAULT '',
      file_path TEXT NOT NULL,
      duration REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    )
  `);

  exec(`
    CREATE TABLE IF NOT EXISTS user_dubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      replica_id INTEGER NOT NULL REFERENCES replicas(id) ON DELETE CASCADE,
      audio_path TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, replica_id)
    )
  `);

  saveDb();
  console.log('[db] SQLite initialized via sql.js');
}

// --- User queries ---

function upsertUser(telegramId, username, firstName, lastName) {
  const existing = get('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
  if (existing) {
    run('UPDATE users SET username = COALESCE(?, username), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name) WHERE telegram_id = ?',
      [username, firstName, lastName, telegramId]);
  } else {
    run('INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?)',
      [telegramId, username, firstName, lastName]);
  }
  saveDb();
}

function getUserByTelegramId(telegramId) {
  return get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

// --- Project queries ---

function getAllProjects() {
  return all('SELECT * FROM projects ORDER BY name');
}

function getProjectById(id) {
  return get('SELECT * FROM projects WHERE id = ?', [id]);
}

function upsertProject(name, folderPath) {
  const existing = get('SELECT id FROM projects WHERE name = ?', [name]);
  if (existing) {
    run('UPDATE projects SET folder_path = ? WHERE name = ?', [folderPath, name]);
  } else {
    run('INSERT INTO projects (name, folder_path) VALUES (?, ?)', [name, folderPath]);
  }
  saveDb();
}

// --- Character queries ---

function getCharactersByProject(projectId) {
  return all('SELECT * FROM characters WHERE project_id = ? ORDER BY name', [projectId]);
}

function getCharacterById(id) {
  return get('SELECT * FROM characters WHERE id = ?', [id]);
}

function upsertCharacter(projectId, name, folderPath) {
  const existing = get('SELECT id FROM characters WHERE project_id = ? AND name = ?', [projectId, name]);
  if (existing) {
    run('UPDATE characters SET folder_path = ? WHERE id = ?', [folderPath, existing.id]);
  } else {
    run('INSERT INTO characters (project_id, name, folder_path) VALUES (?, ?, ?)', [projectId, name, folderPath]);
  }
  saveDb();
}

// --- Replica queries ---

function getReplicasByCharacter(characterId) {
  return all('SELECT * FROM replicas WHERE character_id = ? ORDER BY sort_order, filename', [characterId]);
}

function getReplicaById(id) {
  return get('SELECT * FROM replicas WHERE id = ?', [id]);
}

function upsertReplica(characterId, mediaId, filename, transcript, translation, filePath, sortOrder, duration) {
  const existing = get('SELECT id FROM replicas WHERE character_id = ? AND media_id = ?', [characterId, mediaId]);
  if (existing) {
    run('UPDATE replicas SET filename = ?, transcript = ?, translation = ?, file_path = ?, sort_order = ?, duration = ? WHERE id = ?',
      [filename, transcript, translation, filePath, sortOrder, duration || 0, existing.id]);
    return existing.id;
  } else {
    return run('INSERT INTO replicas (character_id, media_id, filename, transcript, translation, file_path, sort_order, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [characterId, String(mediaId), filename, transcript, translation, filePath, sortOrder, duration || 0]).lastInsertRowid;
  }
}

// --- User dubs queries ---

function getOrCreateDub(userId, replicaId) {
  const existing = get('SELECT * FROM user_dubs WHERE user_id = ? AND replica_id = ?', [userId, replicaId]);
  if (existing) return existing;
  run('INSERT INTO user_dubs (user_id, replica_id, status) VALUES (?, ?, ?)', [userId, replicaId, 'pending']);
  return get('SELECT * FROM user_dubs WHERE user_id = ? AND replica_id = ?', [userId, replicaId]);
}

function submitDub(dubId, audioPath) {
  run("UPDATE user_dubs SET status = 'submitted', audio_path = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
    [audioPath, dubId]);
  saveDb();
}

function discardDub(dubId) {
  run("UPDATE user_dubs SET status = 'pending', audio_path = NULL WHERE id = ?", [dubId]);
  saveDb();
}

function rejectDub(dubId) {
  run("UPDATE user_dubs SET status = 'rejected' WHERE id = ?", [dubId]);
  saveDb();
}

function getDubById(dubId) {
  return get(`
    SELECT d.*, r.media_id, r.transcript, c.name as character_name, p.name as project_name,
           u.telegram_id, u.username
    FROM user_dubs d
    JOIN users u ON d.user_id = u.id
    JOIN replicas r ON d.replica_id = r.id
    JOIN characters c ON r.character_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE d.id = ?
  `, [dubId]);
}

function getNextPendingReplica(userId, characterId) {
  return get(`
    SELECT r.* FROM replicas r
    WHERE r.character_id = ?
      AND r.id NOT IN (
        SELECT replica_id FROM user_dubs
        WHERE user_id = ? AND status = 'submitted'
      )
    ORDER BY r.sort_order, r.filename
    LIMIT 1
  `, [characterId, userId]);
}

function getRejectedReplicas(userId, characterId) {
  return all(`
    SELECT r.*, d.id as dub_id, d.status as dub_status
    FROM replicas r
    JOIN user_dubs d ON d.replica_id = r.id
    WHERE r.character_id = ? AND d.user_id = ? AND d.status = 'rejected'
    ORDER BY r.sort_order, r.filename
  `, [characterId, userId]);
}

function getPendingCount(userId, characterId) {
  const r = get(`
    SELECT COUNT(*) as count FROM replicas r
    WHERE r.character_id = ?
      AND r.id NOT IN (
        SELECT replica_id FROM user_dubs
        WHERE user_id = ? AND status = 'submitted'
      )
  `, [characterId, userId]);
  return r ? r.count : 0;
}

function getSubmittedCount(userId, characterId) {
  const r = get(`
    SELECT COUNT(*) as count FROM user_dubs
    WHERE user_id = ? AND replica_id IN (
      SELECT id FROM replicas WHERE character_id = ?
    ) AND status = 'submitted'
  `, [userId, characterId]);
  return r ? r.count : 0;
}

function getTotalReplicasCount(characterId) {
  const r = get('SELECT COUNT(*) as count FROM replicas WHERE character_id = ?', [characterId]);
  return r ? r.count : 0;
}

// --- Cleanup ---

function clearProjectData() {
  run('DELETE FROM replicas');
  run('DELETE FROM characters');
  run('DELETE FROM projects');
  saveDb();
}

function clearOrphanedReplicas() {
  run("DELETE FROM replicas WHERE id NOT IN (SELECT DISTINCT replica_id FROM user_dubs)");
  saveDb();
}

// --- Assignment queries ---

function assignUserToCharacter(characterId, telegramId) {
  run('UPDATE characters SET assigned_telegram_id = ? WHERE id = ?', [telegramId, characterId]);
  saveDb();
}

function unassignCharacter(characterId) {
  run('UPDATE characters SET assigned_telegram_id = NULL WHERE id = ?', [characterId]);
  saveDb();
}

function setPreviewLimit(characterId, limit) {
  run('UPDATE characters SET preview_limit = ? WHERE id = ?', [limit, characterId]);
  saveDb();
}

function getCharactersWithAssignments(projectId) {
  return all(`
    SELECT c.*, u.username as assigned_username, u.first_name as assigned_first_name
    FROM characters c
    LEFT JOIN users u ON c.assigned_telegram_id = u.telegram_id
    WHERE c.project_id = ?
    ORDER BY c.name
  `, [projectId]);
}

function getAssignmentByCharacter(characterId) {
  return get(`
    SELECT c.*, u.username as assigned_username, u.first_name as assigned_first_name
    FROM characters c
    LEFT JOIN users u ON c.assigned_telegram_id = u.telegram_id
    WHERE c.id = ?
  `, [characterId]);
}

function getAllCharactersWithAssignments() {
  return all(`
    SELECT c.*, p.name as project_name, u.username as assigned_username, u.first_name as assigned_first_name
    FROM characters c
    JOIN projects p ON c.project_id = p.id
    LEFT JOIN users u ON c.assigned_telegram_id = u.telegram_id
    ORDER BY p.name, c.name
  `);
}

// --- Dubs report ---

function getDubsReport(characterId) {
  return all(`
    SELECT u.telegram_id, u.username, u.first_name, r.media_id, r.transcript,
           d.status, d.audio_path, d.created_at
    FROM user_dubs d
    JOIN users u ON d.user_id = u.id
    JOIN replicas r ON d.replica_id = r.id
    WHERE r.character_id = ?
    ORDER BY u.username, r.sort_order
  `, [characterId]);
}

function getAllDubsReport() {
  return all(`
    SELECT d.id as dub_id, p.name as project, c.name as character, r.media_id,
           u.username, u.first_name, u.telegram_id,
           d.status, d.audio_path, d.created_at
    FROM user_dubs d
    JOIN users u ON d.user_id = u.id
    JOIN replicas r ON d.replica_id = r.id
    JOIN characters c ON r.character_id = c.id
    JOIN projects p ON c.project_id = p.id
    WHERE d.status = 'submitted'
    ORDER BY p.name, c.name, r.sort_order
  `);
}

// --- Stats ---

function getStats() {
  return {
    users: get('SELECT COUNT(*) as count FROM users').count,
    projects: get('SELECT COUNT(*) as count FROM projects').count,
    characters: get('SELECT COUNT(*) as count FROM characters').count,
    replicas: get('SELECT COUNT(*) as count FROM replicas').count,
    submittedDubs: get("SELECT COUNT(*) as count FROM user_dubs WHERE status = 'submitted'").count,
  };
}

function getDb() {
  return db;
}

module.exports = {
  initDb,
  getDb,
  saveDb,
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
  rejectDub,
  getDubById,
  getNextPendingReplica,
  getRejectedReplicas,
  getPendingCount,
  getSubmittedCount,
  getTotalReplicasCount,
  clearProjectData,
  clearOrphanedReplicas,
  assignUserToCharacter,
  unassignCharacter,
  setPreviewLimit,
  getCharactersWithAssignments,
  getAssignmentByCharacter,
  getAllCharactersWithAssignments,
  getDubsReport,
  getAllDubsReport,
  getStats,
};
