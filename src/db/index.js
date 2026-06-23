const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'u3551263_default',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'u3551263_default',
  connectionLimit: 5,
};

let pool;

var tablesReady = false;

async function getPool() {
  if (!pool) {
    pool = mysql.createPool(DB_CONFIG);
  }
  if (!tablesReady) {
    await initTables();
    tablesReady = true;
  }
  return pool;
}

async function query(sql, params) {
  var p = await getPool();
  var [rows] = await p.query(sql, params || []);
  return rows;
}

async function queryOne(sql, params) {
  var rows = await query(sql, params || []);
  return rows[0] || null;
}

async function initTables() {
  await query("CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, telegram_id BIGINT UNIQUE NOT NULL, username VARCHAR(255), first_name VARCHAR(255), last_name VARCHAR(255), created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  await query("CREATE TABLE IF NOT EXISTS projects (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) UNIQUE NOT NULL, folder_path TEXT NOT NULL)");
  await query("CREATE TABLE IF NOT EXISTS characters (id INT AUTO_INCREMENT PRIMARY KEY, project_id INT NOT NULL, name VARCHAR(255) NOT NULL, folder_path TEXT NOT NULL, assigned_telegram_id BIGINT DEFAULT NULL, preview_limit INT DEFAULT 0, UNIQUE KEY unique_char (project_id, name), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE)");
  await query("CREATE TABLE IF NOT EXISTS replicas (id INT AUTO_INCREMENT PRIMARY KEY, character_id INT NOT NULL, media_id VARCHAR(100) DEFAULT '', filename VARCHAR(255) NOT NULL, transcript TEXT, translation TEXT, file_path TEXT NOT NULL, duration FLOAT DEFAULT 0, sort_order INT DEFAULT 0, FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE)");
  await query("CREATE TABLE IF NOT EXISTS user_dubs (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, replica_id INT NOT NULL, audio_path TEXT, status VARCHAR(20) DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY unique_dub (user_id, replica_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY (replica_id) REFERENCES replicas(id) ON DELETE CASCADE)");
  console.log('[db] MySQL tables ready');
}

// --- User queries ---

async function upsertUser(telegramId, username, firstName, lastName) {
  await query("INSERT INTO users (telegram_id, username, first_name, last_name) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE username = COALESCE(?, username), first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name)", [telegramId, username || null, firstName || null, lastName || null, username || null, firstName || null, lastName || null]);
}

async function getUserByTelegramId(telegramId) {
  return queryOne('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
}

// --- Project queries ---

async function getAllProjects() { return query('SELECT * FROM projects ORDER BY name'); }
async function getProjectById(id) { return queryOne('SELECT * FROM projects WHERE id = ?', [id]); }

async function upsertProject(name, folderPath) {
  await query("INSERT INTO projects (name, folder_path) VALUES (?, ?) ON DUPLICATE KEY UPDATE folder_path = VALUES(folder_path)", [name, folderPath]);
}

// --- Character queries ---

async function getCharactersByProject(projectId) { return query('SELECT * FROM characters WHERE project_id = ? ORDER BY name', [projectId]); }
async function getCharacterById(id) { return queryOne('SELECT * FROM characters WHERE id = ?', [id]); }

async function upsertCharacter(projectId, name, folderPath) {
  await query("INSERT INTO characters (project_id, name, folder_path) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE folder_path = VALUES(folder_path)", [projectId, name, folderPath]);
}

// --- Replica queries ---

async function getReplicasByCharacter(cId) { return query('SELECT * FROM replicas WHERE character_id = ? ORDER BY sort_order, filename', [cId]); }
async function getReplicaById(id) { return queryOne('SELECT * FROM replicas WHERE id = ?', [id]); }

async function upsertReplica(characterId, mediaId, filename, transcript, translation, filePath, sortOrder, duration) {
  var result = await query("INSERT INTO replicas (character_id, media_id, filename, transcript, translation, file_path, sort_order, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE filename = VALUES(filename), transcript = VALUES(transcript), translation = VALUES(translation), file_path = VALUES(file_path), sort_order = VALUES(sort_order), duration = VALUES(duration)", [characterId, String(mediaId), filename, transcript, translation, filePath, sortOrder || 0, duration || 0]);
  return result.insertId;
}

// --- User dubs ---

async function getOrCreateDub(userId, replicaId) {
  var row = await queryOne('SELECT * FROM user_dubs WHERE user_id = ? AND replica_id = ?', [userId, replicaId]);
  if (row) return row;
  await query("INSERT INTO user_dubs (user_id, replica_id, status) VALUES (?, ?, 'pending')", [userId, replicaId]);
  return queryOne('SELECT * FROM user_dubs WHERE user_id = ? AND replica_id = ?', [userId, replicaId]);
}

async function submitDub(dubId, audioPath) {
  await query("UPDATE user_dubs SET status = 'submitted', audio_path = ?, created_at = NOW() WHERE id = ?", [audioPath || '', dubId]);
}

async function discardDub(dubId) {
  await query("UPDATE user_dubs SET status = 'pending', audio_path = NULL WHERE id = ?", [dubId]);
}

async function rejectDub(dubId) {
  await query("UPDATE user_dubs SET status = 'rejected' WHERE id = ?", [dubId]);
}

async function getDubById(dubId) {
  return queryOne("SELECT d.*, r.media_id, r.transcript, c.name as character_name, p.name as project_name, u.telegram_id, u.username FROM user_dubs d JOIN users u ON d.user_id = u.id JOIN replicas r ON d.replica_id = r.id JOIN characters c ON r.character_id = c.id JOIN projects p ON c.project_id = p.id WHERE d.id = ?", [dubId]);
}

async function getNextPendingReplica(userId, characterId) {
  return queryOne("SELECT r.* FROM replicas r WHERE r.character_id = ? AND r.id NOT IN (SELECT replica_id FROM user_dubs WHERE user_id = ? AND status = 'submitted') ORDER BY r.sort_order, r.filename LIMIT 1", [characterId, userId]);
}

async function getRejectedReplicas(userId, characterId) {
  return query("SELECT r.*, d.id as dub_id, d.status as dub_status FROM replicas r JOIN user_dubs d ON d.replica_id = r.id WHERE r.character_id = ? AND d.user_id = ? AND d.status = 'rejected' ORDER BY r.sort_order, r.filename", [characterId, userId]);
}

async function getPendingCount(userId, characterId) {
  var r = await queryOne("SELECT COUNT(*) as count FROM replicas r WHERE r.character_id = ? AND r.id NOT IN (SELECT replica_id FROM user_dubs WHERE user_id = ? AND status = 'submitted')", [characterId, userId]);
  return r ? r.count : 0;
}

async function getSubmittedCount(userId, characterId) {
  var r = await queryOne("SELECT COUNT(*) as count FROM user_dubs WHERE user_id = ? AND replica_id IN (SELECT id FROM replicas WHERE character_id = ?) AND status = 'submitted'", [userId, characterId]);
  return r ? r.count : 0;
}

async function getTotalReplicasCount(characterId) {
  var r = await queryOne('SELECT COUNT(*) as count FROM replicas WHERE character_id = ?', [characterId]);
  return r ? r.count : 0;
}

// --- Cleanup ---

async function clearProjectData() {
  await query('DELETE FROM user_dubs');
  await query('DELETE FROM replicas');
  await query('DELETE FROM characters');
  await query('DELETE FROM projects');
}

async function clearOrphanedReplicas() {
  await query("DELETE FROM replicas WHERE id NOT IN (SELECT DISTINCT replica_id FROM user_dubs)");
}

// --- Assignments ---

async function assignUserToCharacter(charId, telegramId) { await query('UPDATE characters SET assigned_telegram_id = ? WHERE id = ?', [telegramId, charId]); }
async function unassignCharacter(charId) { await query('UPDATE characters SET assigned_telegram_id = NULL WHERE id = ?', [charId]); }
async function setPreviewLimit(charId, limit) { await query('UPDATE characters SET preview_limit = ? WHERE id = ?', [limit, charId]); }

async function getCharactersWithAssignments(projectId) {
  return query("SELECT c.*, u.username as assigned_username, u.first_name as assigned_first_name FROM characters c LEFT JOIN users u ON c.assigned_telegram_id = u.telegram_id WHERE c.project_id = ? ORDER BY c.name", [projectId]);
}

async function getAssignmentByCharacter(charId) {
  return queryOne("SELECT c.*, u.username as assigned_username, u.first_name as assigned_first_name FROM characters c LEFT JOIN users u ON c.assigned_telegram_id = u.telegram_id WHERE c.id = ?", [charId]);
}

async function getAllCharactersWithAssignments() {
  return query("SELECT c.*, p.name as project_name, u.username as assigned_username, u.first_name as assigned_first_name FROM characters c JOIN projects p ON c.project_id = p.id LEFT JOIN users u ON c.assigned_telegram_id = u.telegram_id ORDER BY p.name, c.name");
}

// --- Reports ---

async function getDubsReport(charId) {
  return query("SELECT u.telegram_id, u.username, u.first_name, r.media_id, r.transcript, d.status, d.audio_path, d.created_at FROM user_dubs d JOIN users u ON d.user_id = u.id JOIN replicas r ON d.replica_id = r.id WHERE r.character_id = ? ORDER BY u.username, r.sort_order", [charId]);
}

async function getAllDubsReport() {
  return query("SELECT d.id as dub_id, p.name as project, c.name as character, r.media_id, u.username, u.first_name, u.telegram_id, d.status, d.audio_path, d.created_at FROM user_dubs d JOIN users u ON d.user_id = u.id JOIN replicas r ON d.replica_id = r.id JOIN characters c ON r.character_id = c.id JOIN projects p ON c.project_id = p.id WHERE d.status = 'submitted' ORDER BY p.name, c.name, r.sort_order");
}

// --- Stats ---

async function getStats() {
  var u = await queryOne('SELECT COUNT(*) as count FROM users');
  var p = await queryOne('SELECT COUNT(*) as count FROM projects');
  var c = await queryOne('SELECT COUNT(*) as count FROM characters');
  var r = await queryOne('SELECT COUNT(*) as count FROM replicas');
  var d = await queryOne("SELECT COUNT(*) as count FROM user_dubs WHERE status = 'submitted'");
  return { users: u.count, projects: p.count, characters: c.count, replicas: r.count, submittedDubs: d.count };
}

function getDb() { return pool; }

module.exports = {
  initDb: initTables,
  getDb, upsertUser, getUserByTelegramId, getAllProjects, getProjectById, upsertProject,
  getCharactersByProject, getCharacterById, upsertCharacter, getReplicasByCharacter, getReplicaById, upsertReplica,
  getOrCreateDub, submitDub, discardDub, rejectDub, getDubById, getNextPendingReplica, getRejectedReplicas,
  getPendingCount, getSubmittedCount, getTotalReplicasCount, clearProjectData, clearOrphanedReplicas,
  assignUserToCharacter, unassignCharacter, setPreviewLimit,
  getCharactersWithAssignments, getAssignmentByCharacter, getAllCharactersWithAssignments,
  getDubsReport, getAllDubsReport, getStats,
};
