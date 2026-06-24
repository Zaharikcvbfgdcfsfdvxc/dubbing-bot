const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'dubbing.db');

let db, SQL;

function run(sql, params) {
  var p = params || [];
  db.run(sql, p);
  var r = db.exec('SELECT last_insert_rowid()');
  return { lastInsertRowid: r.length && r[0].values.length ? r[0].values[0][0] : null };
}

function get(sql, params) {
  var stmt = db.prepare(sql); stmt.bind(params || []);
  var row = null;
  if (stmt.step()) { var c = stmt.getColumnNames(), v = stmt.get(); row = {}; for (var i = 0; i < c.length; i++) row[c[i]] = v[i]; }
  stmt.free(); return row;
}

function all(sql, params) {
  var stmt = db.prepare(sql); stmt.bind(params || []); var rows = [];
  while (stmt.step()) { var c = stmt.getColumnNames(), v = stmt.get(), r = {}; for (var i = 0; i < c.length; i++) r[c[i]] = v[i]; rows.push(r); }
  stmt.free(); return rows;
}

function exec(sql) { return db.exec(sql); }

function saveDb() {
  var data = db.export(); var buf = Buffer.from(data);
  var dir = path.dirname(DB_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buf);
}

async function initDb() {
  var initSqlJs = require('sql.js');
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) { var buf = fs.readFileSync(DB_PATH); db = new SQL.Database(buf); }
  else { db = new SQL.Database(); }

  exec("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER UNIQUE NOT NULL, username TEXT, first_name TEXT, last_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  exec("CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, folder_path TEXT NOT NULL)");
  exec("CREATE TABLE IF NOT EXISTS characters (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL, folder_path TEXT NOT NULL, assigned_telegram_id INTEGER DEFAULT NULL, preview_limit INTEGER DEFAULT 0, UNIQUE(project_id, name))");
  exec("CREATE TABLE IF NOT EXISTS replicas (id INTEGER PRIMARY KEY AUTOINCREMENT, character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE, media_id TEXT DEFAULT '', filename TEXT NOT NULL, transcript TEXT DEFAULT '', translation TEXT DEFAULT '', file_path TEXT NOT NULL, duration REAL DEFAULT 0, sort_order INTEGER DEFAULT 0)");
  exec("CREATE TABLE IF NOT EXISTS user_dubs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, replica_id INTEGER NOT NULL REFERENCES replicas(id) ON DELETE CASCADE, audio_path TEXT, status TEXT DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, replica_id))");
  saveDb();
  console.log('[db] SQLite ready');
}

// --- User ---
async function upsertUser(telegramId, username, firstName, lastName) {
  var e = get('SELECT id FROM users WHERE telegram_id = ?', [telegramId]);
  if (e) run('UPDATE users SET username=COALESCE(?,username), first_name=COALESCE(?,first_name), last_name=COALESCE(?,last_name) WHERE telegram_id=?', [username,firstName,lastName,telegramId]);
  else run('INSERT INTO users (telegram_id,username,first_name,last_name) VALUES (?,?,?,?)', [telegramId,username,firstName,lastName]);
  saveDb();
}
async function getUserByTelegramId(id) { return get('SELECT * FROM users WHERE telegram_id = ?', [id]); }
async function getUserByUsername(username) { return get('SELECT * FROM users WHERE username = ?', [username]); }

// --- Projects ---
async function getAllProjects() { return all('SELECT * FROM projects ORDER BY name'); }
async function getProjectById(id) { return get('SELECT * FROM projects WHERE id = ?', [id]); }
async function upsertProject(name, folderPath) {
  var e = get('SELECT id FROM projects WHERE name = ?', [name]);
  if (e) run('UPDATE projects SET folder_path=? WHERE name=?', [folderPath,name]);
  else run('INSERT INTO projects (name,folder_path) VALUES (?,?)', [name,folderPath]);
  saveDb();
}
async function deleteProject(id) {
  // Check if any user_dubs exist for this project before cascading
  var dubs = get("SELECT COUNT(*) as cnt FROM user_dubs d JOIN replicas r ON d.replica_id=r.id JOIN characters c ON r.character_id=c.id WHERE c.project_id=?", [id]);
  if (dubs && dubs.cnt > 0) {
    console.log(`[db] deleteProject: project ${id} has ${dubs.cnt} user_dubs, skipping`);
    return false;
  }
  run('DELETE FROM characters WHERE project_id=?', [id]);
  run('DELETE FROM projects WHERE id=?', [id]);
  saveDb();
  return true;
}

// --- Characters ---
async function getCharactersByProject(pid) { return all('SELECT * FROM characters WHERE project_id=? ORDER BY name', [pid]); }
async function getCharacterById(id) { return get('SELECT * FROM characters WHERE id=?', [id]); }
async function upsertCharacter(projectId, name, folderPath) {
  var e = get('SELECT id FROM characters WHERE project_id=? AND name=?', [projectId,name]);
  if (e) run('UPDATE characters SET folder_path=? WHERE id=?', [folderPath,e.id]);
  else run('INSERT INTO characters (project_id,name,folder_path) VALUES (?,?,?)', [projectId,name,folderPath]);
  saveDb();
}

// --- Replicas ---
async function getReplicasByCharacter(cid) { return all('SELECT * FROM replicas WHERE character_id=? ORDER BY sort_order,filename', [cid]); }
async function getReplicaById(id) { return get('SELECT * FROM replicas WHERE id=?', [id]); }
async function upsertReplica(characterId, mediaId, filename, transcript, translation, filePath, sortOrder, duration) {
  var e = get('SELECT id FROM replicas WHERE character_id=? AND media_id=?', [characterId, String(mediaId)]);
  if (e) {
    run('UPDATE replicas SET filename=?,transcript=?,translation=?,file_path=?,sort_order=?,duration=? WHERE id=?', [filename,transcript,translation,filePath,sortOrder,duration||0,e.id]);
    return e.id;
  }
  var r = run('INSERT INTO replicas (character_id,media_id,filename,transcript,translation,file_path,sort_order,duration) VALUES (?,?,?,?,?,?,?,?)', [characterId,String(mediaId),filename,transcript,translation,filePath,sortOrder,duration||0]);
  saveDb(); return r.lastInsertRowid;
}

// --- Dubs ---
async function getOrCreateDub(userId, replicaId) {
  var e = get('SELECT * FROM user_dubs WHERE user_id=? AND replica_id=?', [userId,replicaId]);
  if (e) return e;
  run("INSERT INTO user_dubs (user_id,replica_id,status) VALUES (?,?,'pending')", [userId,replicaId]);
  return get('SELECT * FROM user_dubs WHERE user_id=? AND replica_id=?', [userId,replicaId]);
}
async function submitDub(dubId, audioPath) { run("UPDATE user_dubs SET status='submitted',audio_path=?,created_at=CURRENT_TIMESTAMP WHERE id=?", [audioPath||'',dubId]); saveDb(); }
async function discardDub(dubId) { run("UPDATE user_dubs SET status='pending',audio_path=NULL WHERE id=?", [dubId]); saveDb(); }
async function rejectDub(dubId) { run("UPDATE user_dubs SET status='rejected' WHERE id=?", [dubId]); saveDb(); }
async function getDubById(dubId) {
  return get("SELECT d.*, r.media_id, r.transcript, c.name as character_name, p.name as project_name, u.telegram_id, u.username FROM user_dubs d JOIN users u ON d.user_id=u.id JOIN replicas r ON d.replica_id=r.id JOIN characters c ON r.character_id=c.id JOIN projects p ON c.project_id=p.id WHERE d.id=?", [dubId]);
}
async function getNextPendingReplica(userId, characterId) {
  return get("SELECT r.* FROM replicas r WHERE r.character_id=? AND r.id NOT IN (SELECT replica_id FROM user_dubs WHERE user_id=? AND status='submitted') ORDER BY r.sort_order, r.filename LIMIT 1", [characterId,userId]);
}
async function getRejectedReplicas(userId, characterId) {
  return all("SELECT r.*, d.id as dub_id, d.status as dub_status FROM replicas r JOIN user_dubs d ON d.replica_id=r.id WHERE r.character_id=? AND d.user_id=? AND d.status='rejected' ORDER BY r.sort_order, r.filename", [characterId,userId]);
}
async function getPendingCount(userId, cid) {
  var r = get("SELECT COUNT(*) as count FROM replicas r WHERE r.character_id=? AND r.id NOT IN (SELECT replica_id FROM user_dubs WHERE user_id=? AND status='submitted')", [cid,userId]);
  return r ? r.count : 0;
}
async function getSubmittedCount(userId, cid) {
  var r = get("SELECT COUNT(*) as count FROM user_dubs WHERE user_id=? AND replica_id IN (SELECT id FROM replicas WHERE character_id=?) AND status='submitted'", [userId,cid]);
  return r ? r.count : 0;
}
async function getTotalReplicasCount(cid) { var r = get('SELECT COUNT(*) as count FROM replicas WHERE character_id=?', [cid]); return r ? r.count : 0; }

// --- Cleanup ---
async function clearProjectData() { run('DELETE FROM user_dubs'); run('DELETE FROM replicas'); run('DELETE FROM characters'); run('DELETE FROM projects'); saveDb(); }
async function clearOrphanedReplicas() { run("DELETE FROM replicas WHERE id NOT IN (SELECT DISTINCT replica_id FROM user_dubs)"); saveDb(); }

// --- Assignments ---
async function assignUserToCharacter(cid, tid) { run('UPDATE characters SET assigned_telegram_id=? WHERE id=?', [tid,cid]); saveDb(); }
async function unassignCharacter(cid) { run('UPDATE characters SET assigned_telegram_id=NULL WHERE id=?', [cid]); saveDb(); }
async function setPreviewLimit(cid, lim) { run('UPDATE characters SET preview_limit=? WHERE id=?', [lim,cid]); saveDb(); }
async function getCharactersWithAssignments(pid) { return all("SELECT c.*, u.username as assigned_username, u.first_name as assigned_first_name FROM characters c LEFT JOIN users u ON c.assigned_telegram_id=u.telegram_id WHERE c.project_id=? ORDER BY c.name", [pid]); }
async function getAssignmentByCharacter(cid) { return get("SELECT c.*, u.username as assigned_username, u.first_name as assigned_first_name FROM characters c LEFT JOIN users u ON c.assigned_telegram_id=u.telegram_id WHERE c.id=?", [cid]); }
async function getAllCharactersWithAssignments() { return all("SELECT c.*, p.name as project_name, u.username as assigned_username, u.first_name as assigned_first_name FROM characters c JOIN projects p ON c.project_id=p.id LEFT JOIN users u ON c.assigned_telegram_id=u.telegram_id ORDER BY p.name, c.name"); }

// --- Reports ---
async function getDubsReport(cid) { return all("SELECT u.telegram_id, u.username, u.first_name, r.media_id, r.transcript, d.status, d.audio_path, d.created_at FROM user_dubs d JOIN users u ON d.user_id=u.id JOIN replicas r ON d.replica_id=r.id WHERE r.character_id=? ORDER BY u.username, r.sort_order", [cid]); }
async function getAllDubsReport() { return all("SELECT d.id as dub_id, p.name as project, c.name as character, r.media_id, u.username, u.first_name, u.telegram_id, d.status, d.audio_path, d.created_at FROM user_dubs d JOIN users u ON d.user_id=u.id JOIN replicas r ON d.replica_id=r.id JOIN characters c ON r.character_id=c.id JOIN projects p ON c.project_id=p.id WHERE d.status='submitted' ORDER BY p.name, c.name, r.sort_order"); }
async function getAllReplicasReport() { return all("SELECT p.name as project, c.name as character, r.media_id, r.transcript, r.translation, r.duration FROM replicas r JOIN characters c ON r.character_id=c.id JOIN projects p ON c.project_id=p.id ORDER BY p.name, c.name, r.sort_order"); }

// --- Stats ---
async function getStats() {
  var u = get('SELECT COUNT(*) as count FROM users');
  var p = get('SELECT COUNT(*) as count FROM projects');
  var c = get('SELECT COUNT(*) as count FROM characters');
  var r = get('SELECT COUNT(*) as count FROM replicas');
  var d = get("SELECT COUNT(*) as count FROM user_dubs WHERE status='submitted'");
  return { users: u.count, projects: p.count, characters: c.count, replicas: r.count, submittedDubs: d.count };
}

function getDb() { return db; }

module.exports = {
  initDb, getDb, upsertUser, getUserByTelegramId, getUserByUsername, getAllProjects, getProjectById, upsertProject, deleteProject,
  getCharactersByProject, getCharacterById, upsertCharacter, getReplicasByCharacter, getReplicaById, upsertReplica,
  getOrCreateDub, submitDub, discardDub, rejectDub, getDubById, getNextPendingReplica, getRejectedReplicas,
  getPendingCount, getSubmittedCount, getTotalReplicasCount, clearProjectData, clearOrphanedReplicas,
  assignUserToCharacter, unassignCharacter, setPreviewLimit,
  getCharactersWithAssignments, getAssignmentByCharacter, getAllCharactersWithAssignments,
  getDubsReport, getAllDubsReport, getAllReplicasReport, getStats,
};
