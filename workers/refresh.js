'use strict';

const { getProvider } = require('../src/lib/providers');
const { getJson } = require('../src/lib/http');
const {
  getExchangeRates,
  saveExchangeRates,
  getProviderSnapshot,
  saveProviderSnapshot,
  saveProviderState,
} = require('./store');

const DEFAULT_EXCHANGE_RATE_URL = 'https://api.frankfurter.app/latest?from=USD';

function createExchangeRateService({ state, rateUrl }) {
  async function loadUsdRates(forceRefresh = false) {
    const cached = getExchangeRates(state, 'USD');
    if (!forceRefresh && cached) {
      return cached.payload;
    }

    try {
      const payload = await getJson(rateUrl);
      if (!payload || typeof payload !== 'object') {
        throw new Error('Empty exchange rate payload');
      }
      saveExchangeRates(state, 'USD', payload);
      return payload;
    } catch (error) {
      if (cached) {
        return cached.payload;
      }
      throw error;
    }
  }

  async function convertToUsd(amount, currency) {
    const safeAmount = Number(amount || 0);
    const normalizedCurrency = String(currency || 'USD').toUpperCase();
    if (normalizedCurrency === 'USD') return safeAmount;

    const payload = await loadUsdRates(false);
    const rates = payload?.rates || {};
    const rateFromUsd = Number(rates[normalizedCurrency]);
    if (!Number.isFinite(rateFromUsd) || rateFromUsd <= 0) {
      throw new Error(`Missing exchange rate for ${normalizedCurrency}`);
    }
    return safeAmount / rateFromUsd;
  }

  return {
    convertToUsd,
    loadUsdRates,
  };
}

function getReusableProviderResult(state, mapping) {
  const minRefreshIntervalMs = Number(mapping.minRefreshIntervalMs || 0);
  const errorRetryIntervalMs = Number(mapping.errorRetryIntervalMs || 0);
  if (!minRefreshIntervalMs && !errorRetryIntervalMs) return null;

  const providerState = state.states[mapping.providerKey];
  const lastAttempt = providerState?.last_attempted_at || providerState?.last_success_at;
  if (!lastAttempt) return null;

  const effectiveIntervalMs = ['error', 'stale'].includes(providerState.status) && errorRetryIntervalMs
    ? errorRetryIntervalMs
    : minRefreshIntervalMs;
  if (!effectiveIntervalMs) return null;
  const lastAttemptMs = new Date(lastAttempt).getTime();
  if (!Number.isFinite(lastAttemptMs) || Date.now() - lastAttemptMs >= effectiveIntervalMs) return null;

  const snapshot = getProviderSnapshot(state, mapping.providerKey);
  if (!snapshot?.payload) return null;

  return {
    ...snapshot.payload,
    providerKey: mapping.providerKey,
    providerName: mapping.displayName,
    skipped: true,
  };
}

async function runRefresh({ state, env, serviceConfig, reason = 'scheduled' }) {
  const rateUrl = env.EXCHANGE_RATE_URL || DEFAULT_EXCHANGE_RATE_URL;
  const exchangeRateService = createExchangeRateService({ state, rateUrl });
  const startedAt = new Date().toISOString();

  state.serviceConfig = serviceConfig;

  try {
    await exchangeRateService.loadUsdRates(reason === 'manual');

    const results = await Promise.all(serviceConfig.providerMappings.map(async (mapping) => {
      const reusableResult = getReusableProviderResult(state, mapping);
      if (reusableResult) return reusableResult;

      const provider = getProvider(mapping.providerKey);
      const apiKey = env[mapping.keyEnv] || '';
      const result = await provider.fetchProviderOffers({
        mapping,
        apiKey,
        exchangeRateService,
        previousSnapshot: getProviderSnapshot(state, mapping.providerKey)?.payload || null,
      });

      const attemptedAt = new Date().toISOString();
      if (result.error) {
        const existing = state.states[mapping.providerKey];
        saveProviderState(state, {
          provider_key: mapping.providerKey,
          status: existing?.last_success_at ? 'stale' : 'error',
          last_attempted_at: attemptedAt,
          last_success_at: existing?.last_success_at || null,
          error_message: result.error,
        });
        return result;
      }

      saveProviderSnapshot(state, mapping.providerKey, result);
      saveProviderState(state, {
        provider_key: mapping.providerKey,
        status: 'success',
        last_attempted_at: attemptedAt,
        last_success_at: attemptedAt,
        error_message: '',
      });
      return result;
    }));

    state.latestRefresh = {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'success',
      details_json: JSON.stringify({
        reason,
        providers: results.map((result) => ({
          providerKey: result.providerKey,
          error: result.error,
          offerCount: result.offers?.length || 0,
          skipped: Boolean(result.skipped),
        })),
      }),
    };
    return { accepted: true, status: 'success' };
  } catch (error) {
    state.latestRefresh = {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: 'error',
      details_json: JSON.stringify({ reason, error: error.message }),
    };
    return { accepted: true, status: 'error', error: error.message };
  }
}

module.exports = {
  runRefresh,
};
