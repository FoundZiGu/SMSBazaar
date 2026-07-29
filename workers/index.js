import serviceConfig from '../src/config/service-config';
import { aggregateByCountry } from '../src/lib/aggregator';
import {
  loadOpenAiSupportedCountries,
  loadOpenAiSupportedWhatsAppCountries,
  loadRecommendedCountryConfig,
} from './config-data';
import { runRefresh } from './refresh';
import {
  loadState,
  saveState,
  getAllProviderSnapshots,
  getAllProviderStates,
  getExchangeRates,
  getLatestRefreshEvent,
} from './store';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function redactProviderError(env, message) {
  const exposeProviderErrors = String(env.EXPOSE_PROVIDER_ERRORS || '').toLowerCase() === 'true';
  if (exposeProviderErrors) return message || '';
  return message ? '平台异常' : '';
}

function handleMeta(env, state) {
  const latestRefresh = getLatestRefreshEvent(state);
  const states = getAllProviderStates(state);
  const snapshots = new Map(getAllProviderSnapshots(state).map((snapshot) => [snapshot.providerKey, snapshot]));
  const usdRates = getExchangeRates(state, 'USD');
  const recommendationConfig = loadRecommendedCountryConfig(serviceConfig.recommendedWhitelistIso2);
  const openAiSupportedCountries = loadOpenAiSupportedCountries();
  const openAiSupportedWhatsAppCountries = loadOpenAiSupportedWhatsAppCountries();
  const refreshIntervalMs = Number(env.REFRESH_INTERVAL_MS || 60000);

  return jsonResponse({
    service: {
      serviceKey: serviceConfig.serviceKey,
      displayName: serviceConfig.displayName,
      bindWhitelistIso2: serviceConfig.bindWhitelistIso2,
      recommendedWhitelistIso2: recommendationConfig.whitelist,
      registerSupportedWhitelistIso2: openAiSupportedCountries.whitelist,
      whatsappSupportedWhitelistIso2: openAiSupportedWhatsAppCountries.whitelist,
    },
    display: {
      primaryCurrency: 'CNY',
      secondaryCurrency: 'USD',
      cnyRateFromUsd: Number(usdRates?.payload?.rates?.CNY || 7.2),
      refreshIntervalMs,
    },
    recommendationConfig: {
      updatedAt: recommendationConfig.updatedAt,
      source: recommendationConfig.source,
      entries: recommendationConfig.entries,
    },
    countryListSync: {
      status: 'bundled',
      lastSuccessAt: '',
      errorMessage: '',
      apiCountryCount: openAiSupportedCountries.whitelist.length,
      whatsappCountryCount: openAiSupportedWhatsAppCountries.whitelist.length,
    },
    providers: serviceConfig.providerMappings.map((mapping) => {
      const providerState = states.get(mapping.providerKey);
      const snapshot = snapshots.get(mapping.providerKey);
      return {
        providerKey: mapping.providerKey,
        displayName: mapping.displayName,
        configured: Boolean(env[mapping.keyEnv] || mapping.providerKey === 'smsbower' || mapping.providerKey === '5sim'),
        status: providerState?.status || 'idle',
        lastAttemptedAt: providerState?.last_attempted_at || '',
        lastSuccessAt: providerState?.last_success_at || '',
        errorMessage: redactProviderError(env, providerState?.error_message),
        offerCount: snapshot?.payload?.offers?.length || 0,
      };
    }),
    lastRefresh: latestRefresh,
    refreshState: 'idle',
  });
}

function handleCompare(env, state, url) {
  const filters = {
    mode: ['bind', 'recommended', 'whatsapp'].includes(String(url.searchParams.get('mode')))
      ? String(url.searchParams.get('mode'))
      : 'register',
    country: url.searchParams.get('country') || '',
    provider: url.searchParams.get('provider') || '',
    status: url.searchParams.get('status') || '',
    sort: url.searchParams.get('sort') || 'price_asc',
  };

  const snapshots = getAllProviderSnapshots(state);
  const providerStates = getAllProviderStates(state);
  const recommendationConfig = loadRecommendedCountryConfig(serviceConfig.recommendedWhitelistIso2);
  const openAiSupportedCountries = loadOpenAiSupportedCountries();
  const openAiSupportedWhatsAppCountries = loadOpenAiSupportedWhatsAppCountries();
  const rows = aggregateByCountry({
    snapshots,
    states: providerStates,
    filters,
    whitelist: serviceConfig.bindWhitelistIso2,
    recommendedWhitelist: recommendationConfig.whitelist,
    recommendationPathByIso2: recommendationConfig.pathByIso2,
    openAiSupportedWhitelist: openAiSupportedCountries.whitelist,
    whatsappSupportedWhitelist: openAiSupportedWhatsAppCountries.whitelist,
  }).map((row) => ({
    ...row,
    offers: row.offers.map((offer) => ({
      ...offer,
      errorMessage: redactProviderError(env, offer.errorMessage),
    })),
  }));

  const countries = rows.map((row) => ({
    iso2: row.countryIso2,
    name: row.countryName,
    displayName: row.countryDisplayName || row.countryName,
    chineseName: row.countryNameZh || row.countryName,
    englishName: row.countryNameEn || row.countryName,
    recommendationPath: row.recommendationPath,
  }));

  return jsonResponse({
    filters,
    recommendationConfig: {
      updatedAt: recommendationConfig.updatedAt,
      source: recommendationConfig.source,
    },
    countries,
    rows,
    updatedAt: getLatestRefreshEvent(state)?.completed_at || '',
  });
}

async function refreshAndSave(env, reason) {
  const state = await loadState(env.SMSBAZAAR_KV);
  const result = await runRefresh({ state, env, serviceConfig, reason });
  await saveState(env.SMSBAZAAR_KV, state);
  return result;
}

async function handleRefresh(env, ctx, request) {
  const adminRefreshToken = String(env.ADMIN_REFRESH_TOKEN || '').trim();
  if (!adminRefreshToken) {
    return jsonResponse({ accepted: false, reason: 'admin_refresh_not_configured' }, 503);
  }

  const providedToken = String(
    request.headers.get('x-admin-refresh-token')
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    || '',
  ).trim();

  if (providedToken !== adminRefreshToken) {
    return jsonResponse({ accepted: false, reason: 'forbidden' }, 403);
  }

  ctx.waitUntil(refreshAndSave(env, 'manual'));
  return jsonResponse({ accepted: true, status: 'started' }, 202);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/meta' && request.method === 'GET') {
      const state = await loadState(env.SMSBAZAAR_KV);
      return handleMeta(env, state);
    }

    if (url.pathname === '/api/compare' && request.method === 'GET') {
      const state = await loadState(env.SMSBAZAAR_KV);
      return handleCompare(env, state, url);
    }

    if (url.pathname === '/api/refresh' && request.method === 'POST') {
      return handleRefresh(env, ctx, request);
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'not_found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshAndSave(env, 'scheduled'));
  },
};
