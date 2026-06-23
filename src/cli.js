const { scanDataDir } = require('./bot/scanner');
const db = require('./db/index');

const command = process.argv[2] || 'help';

(async () => {
  switch (command) {
    case 'scan': {
      console.log('Scanning data/...');
      const r = await scanDataDir();
      console.log(`Done: ${r.projects} projects, ${r.characters} characters, ${r.replicas} replicas`);
      break;
    }
    case 'stats': {
      const s = await db.getStats();
      console.log(`Users: ${s.users}\nProjects: ${s.projects}\nCharacters: ${s.characters}\nReplicas: ${s.replicas}\nSubmitted: ${s.submittedDubs}`);
      break;
    }
    case 'list': {
      const projects = await db.getAllProjects();
      for (const p of projects) {
        console.log(`\n${p.name}:`);
        const chars = await db.getCharactersByProject(p.id);
        for (const c of chars) {
          const total = await db.getTotalReplicasCount(c.id);
          const a = c.assigned_telegram_id ? ` (assigned: ${c.assigned_telegram_id})` : '';
          console.log(`  ${c.name}: ${total} replicas${a}`);
        }
      }
      break;
    }
    case 'dubs': {
      const report = await db.getAllDubsReport();
      if (!report.length) { console.log('No dubs yet.'); break; }
      let lp = '', lc = '';
      for (const r of report) {
        if (r.project !== lp) { console.log(`\n${r.project}/`); lp = r.project; lc = ''; }
        if (r.character !== lc) { console.log(`  ${r.character}:`); lc = r.character; }
        const who = r.username ? `@${r.username}` : (r.first_name || r.telegram_id);
        console.log(`    #${r.media_id} — ${who}${r.audio_path ? ' 🎤' : ''} (${r.created_at})`);
      }
      break;
    }
    case 'recordings': {
      const path = require('path'), fs = require('fs');
      const recDir = path.join(__dirname, '..', 'data', 'recordings');
      if (!fs.existsSync(recDir)) { console.log('No recordings.'); break; }
      for (const uid of fs.readdirSync(recDir)) {
        const ud = path.join(recDir, uid);
        if (!fs.statSync(ud).isDirectory()) continue;
        const files = fs.readdirSync(ud).filter(f => f.endsWith('.ogg'));
        if (!files.length) continue;
        console.log(`\nUser ${uid}:`);
        for (const f of files) console.log(`  ${f} (${(fs.statSync(path.join(ud, f)).size / 1024).toFixed(0)} KB)`);
      }
      break;
    }
    default:
      console.log('Dubbing Bot CLI\n  scan   stats   list   dubs   recordings');
  }
})().catch(err => { console.error(err); process.exit(1); });
