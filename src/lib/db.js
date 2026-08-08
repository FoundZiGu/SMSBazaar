'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const providerSnapshotCache = new WeakMap();

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function createDatabase(databasePath) {
  ensureParentDir(databasePath);
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS service_configs (
      service_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_snapshots (
      provider_key TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_states (
      provider_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      last_attempted_at TEXT NOT NULL,
      last_success_at TEXT,
      error_message TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      base_currency TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refresh_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}'
    );
  `);

  return db;
}

function upsertServiceConfig(db, serviceConfig) {
  db.prepare(`
    INSERT INTO service_configs (service_key, payload_json, updated_at)
    VALUES (@service_key, @payload_json, @updated_at)
    ON CONFLICT(service_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `).run({
    service_key: serviceConfig.serviceKey,
    payload_json: JSON.stringify(serviceConfig),
    updated_at: new Date().toISOString(),
  });
}

function getServiceConfig(db, serviceKey) {
  const row = db.prepare('SELECT payload_json FROM service_configs WHERE service_key = ?').get(serviceKey);
  return row ? JSON.parse(row.payload_json) : null;
}

function saveProviderSnapshot(db, providerKey, payload) {
  const fetchedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO provider_snapshots (provider_key, payload_json, fetched_at)
    VALUES (@provider_key, @payload_json, @fetched_at)
    ON CONFLICT(provider_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at
  `).run({
    provider_key: providerKey,
    payload_json: JSON.stringify(payload),
    fetched_at: fetchedAt,
  });
  providerSnapshotCache.delete(db);
  return fetchedAt;
}

function getProviderSnapshot(db, providerKey) {
  const row = db.prepare('SELECT payload_json, fetched_at FROM provider_snapshots WHERE provider_key = ?').get(providerKey);
  if (!row) return null;
  return {
    payload: JSON.parse(row.payload_json),
    fetchedAt: row.fetched_at,
  };
}

function getAllProviderSnapshots(db) {
  const cached = providerSnapshotCache.get(db);
  if (cached) return cached;

  const rows = db.prepare('SELECT provider_key, payload_json, fetched_at FROM provider_snapshots').all();
  const snapshots = rows.map((row) => ({
    providerKey: row.provider_key,
    payload: JSON.parse(row.payload_json),
    fetchedAt: row.fetched_at,
  }));
  providerSnapshotCache.set(db, snapshots);
  return snapshots;
}

function saveProviderState(db, state) {
  db.prepare(`
    INSERT INTO provider_states (provider_key, status, last_attempted_at, last_success_at, error_message)
    VALUES (@provider_key, @status, @last_attempted_at, @last_success_at, @error_message)
    ON CONFLICT(provider_key) DO UPDATE SET
      status = excluded.status,
      last_attempted_at = excluded.last_attempted_at,
      last_success_at = excluded.last_success_at,
      error_message = excluded.error_message
  `).run(state);
}

function getAllProviderStates(db) {
  const rows = db.prepare('SELECT * FROM provider_states').all();
  const map = new Map();
  for (const row of rows) {
    map.set(row.provider_key, row);
  }
  return map;
}

function saveExchangeRates(db, baseCurrency, payload) {
  const fetchedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO exchange_rates (base_currency, payload_json, fetched_at)
    VALUES (@base_currency, @payload_json, @fetched_at)
    ON CONFLICT(base_currency) DO UPDATE SET
      payload_json = excluded.payload_json,
      fetched_at = excluded.fetched_at
  `).run({
    base_currency: baseCurrency,
    payload_json: JSON.stringify(payload),
    fetched_at: fetchedAt,
  });
  return fetchedAt;
}

function getExchangeRates(db, baseCurrency) {
  const row = db.prepare('SELECT payload_json, fetched_at FROM exchange_rates WHERE base_currency = ?').get(baseCurrency);
  if (!row) return null;
  return {
    payload: JSON.parse(row.payload_json),
    fetchedAt: row.fetched_at,
  };
}

function insertRefreshEvent(db, startedAt) {
  const info = db.prepare(`
    INSERT INTO refresh_events (started_at, status, details_json)
    VALUES (?, 'running', '{}')
  `).run(startedAt);
  return info.lastInsertRowid;
}

function completeRefreshEvent(db, id, status, details) {
  db.prepare(`
    UPDATE refresh_events
    SET completed_at = ?, status = ?, details_json = ?
    WHERE id = ?
  `).run(new Date().toISOString(), status, JSON.stringify(details || {}), id);
}

function getLatestRefreshEvent(db) {
  const row = db.prepare(`
    SELECT *
    FROM refresh_events
    ORDER BY id DESC
    LIMIT 1
  `).get();
  return row || null;
}

module.exports = {
  completeRefreshEvent,
  createDatabase,
  getAllProviderSnapshots,
  getAllProviderStates,
  getExchangeRates,
  getLatestRefreshEvent,
  getProviderSnapshot,
  getServiceConfig,
  insertRefreshEvent,
  saveExchangeRates,
  saveProviderSnapshot,
  saveProviderState,
  upsertServiceConfig,
};
