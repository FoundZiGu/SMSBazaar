'use strict';

const {
  completeRefreshEvent,
  getAllProviderSnapshots,
  getAllProviderStates,
  getLatestRefreshEvent,
  getProviderSnapshot,
  insertRefreshEvent,
  saveProviderSnapshot,
  saveProviderState,
  upsertServiceConfig,
} = require('./db');
const { getProvider } = require('./providers');

function createRefreshController({ db, exchangeRateService, serviceConfig, refreshCooldownMs }) {
  let isRunning = false;
  let lastManualTriggerAt = 0;
  let currentPromise = null;

  function getReusableProviderResult(mapping, reason) {
    const minRefreshIntervalMs = Number(mapping.minRefreshIntervalMs || 0);
    const errorRetryIntervalMs = Number(mapping.errorRetryIntervalMs || 0);
    if (!minRefreshIntervalMs && !errorRetryIntervalMs) return null;

    const state = db.prepare('SELECT status, last_attempted_at, last_success_at FROM provider_states WHERE provider_key = ?').get(mapping.providerKey);
    const lastAttempt = state?.last_attempted_at || state?.last_success_at;
    if (!lastAttempt) return null;

    const effectiveIntervalMs = state.status === 'error' && errorRetryIntervalMs
      ? errorRetryIntervalMs
      : minRefreshIntervalMs;
    if (!effectiveIntervalMs) return null;
    const lastAttemptMs = new Date(lastAttempt).getTime();
    if (!Number.isFinite(lastAttemptMs) || Date.now() - lastAttemptMs >= effectiveIntervalMs) return null;

    const snapshot = getProviderSnapshot(db, mapping.providerKey);
    if (!snapshot?.payload) return null;

    return {
      ...snapshot.payload,
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      skipped: true,
    };
  }

  async function runRefresh(reason = 'scheduled') {
    if (isRunning) {
      return { accepted: false, reason: 'already_running' };
    }

    if (reason === 'manual') {
      const now = Date.now();
      if (now - lastManualTriggerAt < refreshCooldownMs) {
        return {
          accepted: false,
          reason: 'cooldown',
          cooldownRemainingMs: refreshCooldownMs - (now - lastManualTriggerAt),
        };
      }
      lastManualTriggerAt = now;
    }

    isRunning = true;
    upsertServiceConfig(db, serviceConfig);
    const eventId = insertRefreshEvent(db, new Date().toISOString());

    try {
      await exchangeRateService.loadUsdRates(reason === 'manual');

      const results = await Promise.all(serviceConfig.providerMappings.map(async (mapping) => {
        const reusableResult = getReusableProviderResult(mapping, reason);
        if (reusableResult) return reusableResult;

        const provider = getProvider(mapping.providerKey);
        const apiKey = process.env[mapping.keyEnv] || '';
        const result = await provider.fetchProviderOffers({
          mapping,
          apiKey,
          exchangeRateService,
          previousSnapshot: getProviderSnapshot(db, mapping.providerKey)?.payload || null,
        });

        const attemptedAt = new Date().toISOString();
        if (result.error) {
          const existing = db.prepare('SELECT last_success_at FROM provider_states WHERE provider_key = ?').get(mapping.providerKey);
          saveProviderState(db, {
            provider_key: mapping.providerKey,
            status: 'error',
            last_attempted_at: attemptedAt,
            last_success_at: existing?.last_success_at || null,
            error_message: result.error,
          });
          return result;
        }

        saveProviderSnapshot(db, mapping.providerKey, result);
        saveProviderState(db, {
          provider_key: mapping.providerKey,
          status: 'success',
          last_attempted_at: attemptedAt,
          last_success_at: attemptedAt,
          error_message: '',
        });
        return result;
      }));

      completeRefreshEvent(db, eventId, 'success', {
        reason,
        providers: results.map((result) => ({
          providerKey: result.providerKey,
          error: result.error,
          offerCount: result.offers?.length || 0,
          skipped: Boolean(result.skipped),
        })),
      });
      return { accepted: true, status: 'success' };
    } catch (error) {
      completeRefreshEvent(db, eventId, 'error', {
        reason,
        error: error.message,
      });
      return { accepted: true, status: 'error', error: error.message };
    } finally {
      isRunning = false;
    }
  }

  function getState() {
    return {
      isRunning,
      currentPromise,
      latestEvent: getLatestRefreshEvent(db),
      snapshots: getAllProviderSnapshots(db),
      providerStates: getAllProviderStates(db),
    };
  }

  function refreshAll(reason = 'scheduled') {
    currentPromise = runRefresh(reason)
      .finally(() => {
        currentPromise = null;
      });
    return currentPromise;
  }

  function triggerRefresh(reason = 'manual') {
    if (isRunning) {
      return { accepted: false, reason: 'already_running' };
    }
    if (reason === 'manual') {
      const now = Date.now();
      if (now - lastManualTriggerAt < refreshCooldownMs) {
        return {
          accepted: false,
          reason: 'cooldown',
          cooldownRemainingMs: refreshCooldownMs - (now - lastManualTriggerAt),
        };
      }
      lastManualTriggerAt = now;
    }

    isRunning = true;
    currentPromise = (async () => {
      const eventId = insertRefreshEvent(db, new Date().toISOString());
      upsertServiceConfig(db, serviceConfig);

      try {
        await exchangeRateService.loadUsdRates(reason === 'manual');

        const results = await Promise.all(serviceConfig.providerMappings.map(async (mapping) => {
          const reusableResult = getReusableProviderResult(mapping, reason);
          if (reusableResult) return reusableResult;

          const provider = getProvider(mapping.providerKey);
          const apiKey = process.env[mapping.keyEnv] || '';
          const result = await provider.fetchProviderOffers({
            mapping,
            apiKey,
            exchangeRateService,
            previousSnapshot: getProviderSnapshot(db, mapping.providerKey)?.payload || null,
          });

          const attemptedAt = new Date().toISOString();
          if (result.error) {
            const existing = db.prepare('SELECT last_success_at FROM provider_states WHERE provider_key = ?').get(mapping.providerKey);
            saveProviderState(db, {
              provider_key: mapping.providerKey,
              status: 'error',
              last_attempted_at: attemptedAt,
              last_success_at: existing?.last_success_at || null,
              error_message: result.error,
            });
            return result;
          }

          saveProviderSnapshot(db, mapping.providerKey, result);
          saveProviderState(db, {
            provider_key: mapping.providerKey,
            status: 'success',
            last_attempted_at: attemptedAt,
            last_success_at: attemptedAt,
            error_message: '',
          });
          return result;
        }));

        completeRefreshEvent(db, eventId, 'success', {
          reason,
          providers: results.map((result) => ({
            providerKey: result.providerKey,
            error: result.error,
            offerCount: result.offers?.length || 0,
            skipped: Boolean(result.skipped),
          })),
        });
      } catch (error) {
        completeRefreshEvent(db, eventId, 'error', {
          reason,
          error: error.message,
        });
      } finally {
        isRunning = false;
        currentPromise = null;
      }
    })();

    return {
      accepted: true,
      status: 'started',
    };
  }

  return {
    getState,
    refreshAll,
    triggerRefresh,
  };
}

module.exports = {
  createRefreshController,
};
