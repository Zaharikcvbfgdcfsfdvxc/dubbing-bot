/**
 * CLI for server-side management.
 * Usage:
 *   node src/cli.js scan     — scan data/ directory into DB
 *   node src/cli.js stats    — show DB statistics
 */
const { scanDataDir } = require('./bot/scanner');
const db = require('./db/index');

const command = process.argv[2] || 'help';

switch (command) {
  case 'scan':
    console.log('Scanning data/ directory...');
    const result = scanDataDir();
    console.log(`Done: ${result.projects} projects, ${result.characters} characters, ${result.replicas} replicas`);
    break;

  case 'stats':
    const stats = db.getStats();
    console.log('DB Statistics:');
    console.log(`  Users: ${stats.users}`);
    console.log(`  Projects: ${stats.projects}`);
    console.log(`  Characters: ${stats.characters}`);
    console.log(`  Replicas: ${stats.replicas}`);
    console.log(`  Submitted dubs: ${stats.submittedDubs}`);
    break;

  case 'list':
    const projects = db.getAllProjects();
    for (const p of projects) {
      console.log(`\n${p.name}:`);
      const chars = db.getCharactersByProject(p.id);
      for (const c of chars) {
        const total = db.getTotalReplicasCount(c.id);
        const assigned = c.assigned_telegram_id ? ` (assigned: ${c.assigned_telegram_id})` : '';
        console.log(`  ${c.name}: ${total} replicas${assigned}`);
      }
    }
    break;

  case 'dubs':
    const report = db.getAllDubsReport();
    if (report.length === 0) {
      console.log('No submitted dubs yet.');
    } else {
      console.log('Submitted dubs:');
      let lastProj = '', lastChar = '';
      for (const r of report) {
        if (r.project !== lastProj) {
          console.log(`\n${r.project}/`);
          lastProj = r.project;
          lastChar = '';
        }
        if (r.character !== lastChar) {
          console.log(`  ${r.character}:`);
          lastChar = r.character;
        }
        const who = r.username ? `@${r.username}` : (r.first_name || r.telegram_id);
        console.log(`    #${r.media_id} — ${who} (${r.created_at})`);
      }
    }
    break;

  default:
    console.log('Dubbing Bot CLI');
    console.log('  node src/cli.js scan   — scan data/ into database');
    console.log('  node src/cli.js stats  — show statistics');
    console.log('  node src/cli.js list   — list projects & characters');
    console.log('  node src/cli.js dubs   — who recorded what');
    break;
}
