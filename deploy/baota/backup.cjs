'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const projectDir = '/www/wwwroot/smsbazaar';
const requireProject = createRequire(path.join(projectDir, 'package.json'));
const Database = requireProject('better-sqlite3');
const dotenv = requireProject('dotenv');
const backupDir = '/www/server/smsbazaar-data/backups';
const stateDir = '/var/lib/smsbazaar-maintenance';
const retentionDays = 7;

async function main() {
  process.umask(0o077);
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const staging = fs.mkdtempSync(path.join(backupDir, '.pending-'));
  const envPath = path.join(projectDir, '.env');
  const values = dotenv.parse(fs.readFileSync(envPath));
  const resolveFile = (value) => path.resolve(projectDir, value);
  const db = new Database(resolveFile(values.DATABASE_PATH || './data/app.sqlite'));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archive = path.join(backupDir, `smsbazaar-${stamp}.tar.gz`);
  let archiveVerified = false;

  try {
    await db.backup(path.join(staging, 'app.sqlite'));
    fs.copyFileSync(envPath, path.join(staging, '.env'));
    const configs = {
      'recommended-country-paths.txt': values.RECOMMENDED_COUNTRY_PATHS_FILE || './data/recommended-country-paths.txt',
      'openai-supported-api-countries.txt': values.OPENAI_SUPPORTED_COUNTRIES_FILE || './data/openai-supported-api-countries.txt',
      'openai-supported-whatsapp-countries.txt': values.OPENAI_WHATSAPP_COUNTRIES_FILE || './data/openai-supported-whatsapp-countries.txt',
    };
    for (const [name, source] of Object.entries(configs)) {
      if (fs.existsSync(resolveFile(source))) fs.copyFileSync(resolveFile(source), path.join(staging, name));
    }
    execFileSync('/usr/bin/tar', ['-czf', archive, '-C', staging, '.'], { timeout: 120000, stdio: 'pipe' });
    execFileSync('/usr/bin/gzip', ['-t', archive], { timeout: 120000, stdio: 'pipe' });
    archiveVerified = true;

    // The daily backup captures older history before this retention cleanup.
    const historyCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    db.prepare('DELETE FROM refresh_events WHERE completed_at IS NOT NULL AND completed_at < ?').run(historyCutoff);
    db.pragma('wal_checkpoint(PASSIVE)');
    const cutoff = Date.now() - retentionDays * 86400000;
    for (const name of fs.readdirSync(backupDir)) {
      if (!/^smsbazaar-[\dTZ.-]+\.tar\.gz$/.test(name)) continue;
      const file = path.join(backupDir, name);
      if (file !== archive && fs.lstatSync(file).isFile() && fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
    }
    for (const name of fs.readdirSync(stateDir)) {
      if (!/^memory-\d{4}-\d{2}-\d{2}\.csv$/.test(name)) continue;
      const file = path.join(stateDir, name);
      if (fs.lstatSync(file).isFile() && fs.statSync(file).mtimeMs < Date.now() - 14 * 86400000) fs.unlinkSync(file);
    }
    console.log(`Verified backup: ${path.basename(archive)}`);
  } catch (error) {
    if (!archiveVerified && fs.existsSync(archive)) fs.unlinkSync(archive);
    throw error;
  } finally {
    db.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error('SMSBazaar backup failed; inspect local database and backup directory permissions.');
  process.exitCode = 1;
});
