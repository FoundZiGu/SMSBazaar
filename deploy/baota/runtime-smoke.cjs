'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireStage = createRequire(path.join(process.cwd(), 'package.json'));
const Database = requireStage('better-sqlite3');
const dotenv = requireStage('dotenv');
const { createApp } = requireStage('./src/app');
const { createDatabase, saveProviderSnapshot, saveProviderState, saveExchangeRates } = requireStage('./src/lib/db');

async function main() {
  const productionDir = '/www/wwwroot/smsbazaar';
  const values = dotenv.parse(fs.readFileSync(path.join(productionDir, '.env')));
  const production = new Database(path.resolve(productionDir, values.DATABASE_PATH || './data/app.sqlite'), { readonly: true });
  const db = createDatabase(':memory:');
  let server;
  try {
    for (const row of production.prepare('SELECT provider_key,payload_json FROM provider_snapshots').all()) {
      saveProviderSnapshot(db, row.provider_key, JSON.parse(row.payload_json));
    }
    for (const row of production.prepare('SELECT * FROM provider_states').all()) saveProviderState(db, row);
    const rates = production.prepare("SELECT payload_json FROM exchange_rates WHERE base_currency='USD'").get();
    if (rates) saveExchangeRates(db, 'USD', JSON.parse(rates.payload_json));
    const app = createApp({ db, refreshController: { getState: () => ({ isRunning: false }) } });
    server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const metaResponse = await fetch(`${base}/api/meta`);
    assert.equal(metaResponse.status, 200);
    const meta = await metaResponse.json();
    assert.equal(meta.providers.length, 7);
    const summaryResponse = await fetch(`${base}/api/compare?mode=register&summary=1`);
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json();
    assert.ok(summary.rows.length > 100);
    assert.ok(summary.rows.every((row) => row.offers.length === 0));
    const country = summary.rows[0].countryIso2;
    const detailResponse = await fetch(`${base}/api/compare?mode=register&country=${country}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    assert.ok(detail.rows[0].offers.length > 0);
    for (const mode of ['bind', 'recommended', 'whatsapp']) {
      const response = await fetch(`${base}/api/compare?mode=${mode}&summary=1`);
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.filters.mode, mode);
    }
    const backupPath = path.join(process.cwd(), 'runtime-smoke.sqlite');
    await db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true });
    try {
      assert.equal(backup.pragma('quick_check', { simple: true }), 'ok');
    } finally {
      backup.close();
      fs.unlinkSync(backupPath);
    }
    console.log(JSON.stringify({ node: process.version, sqlitePackage: requireStage('better-sqlite3/package.json').version, countries: summary.rows.length, providerCount: meta.providers.length, detailOffers: detail.rows[0].offers.length, backup: 'ok' }));
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    db.close();
    production.close();
  }
}

main().catch((error) => {
  console.error('Runtime smoke test failed:', error.message);
  process.exitCode = 1;
});
