'use strict';

const STATE_KEY = 'app_state_v1';

function emptyState() {
  return {
    serviceConfig: null,
    snapshots: {},
    states: {},
    exchangeRates: {},
    latestRefresh: null,
  };
}

async function loadState(kv) {
  const raw = await kv.get(STATE_KEY, 'text');
  if (!raw) return emptyState();
  try {
    return { ...emptyState(), ...JSON.parse(raw) };
  } catch (error) {
    return emptyState();
  }
}

async function saveState(kv, state) {
  await kv.put(STATE_KEY, JSON.stringify(state));
}

function getAllProviderSnapshots(state) {
  return Object.entries(state.snapshots).map(([providerKey, entry]) => ({
    providerKey,
    payload: entry.payload,
    fetchedAt: entry.fetchedAt,
  }));
}

function getAllProviderStates(state) {
  const map = new Map();
  for (const [providerKey, row] of Object.entries(state.states)) {
    map.set(providerKey, row);
  }
  return map;
}

function getProviderSnapshot(state, providerKey) {
  return state.snapshots[providerKey] || null;
}

function saveProviderSnapshot(state, providerKey, payload) {
  const fetchedAt = new Date().toISOString();
  state.snapshots[providerKey] = { payload, fetchedAt };
  return fetchedAt;
}

function saveProviderState(state, row) {
  state.states[row.provider_key] = row;
}

function getExchangeRates(state, baseCurrency) {
  return state.exchangeRates[baseCurrency] || null;
}

function saveExchangeRates(state, baseCurrency, payload) {
  const fetchedAt = new Date().toISOString();
  state.exchangeRates[baseCurrency] = { payload, fetchedAt };
  return fetchedAt;
}

function getLatestRefreshEvent(state) {
  return state.latestRefresh || null;
}

module.exports = {
  STATE_KEY,
  emptyState,
  loadState,
  saveState,
  getAllProviderSnapshots,
  getAllProviderStates,
  getProviderSnapshot,
  saveProviderSnapshot,
  saveProviderState,
  getExchangeRates,
  saveExchangeRates,
  getLatestRefreshEvent,
};
