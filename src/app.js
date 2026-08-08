'use strict';

const express = require('express');
const path = require('node:path');
const serviceConfig = require('./config/service-config');
const { aggregateByCountry } = require('./lib/aggregator');
const { loadOpenAiSupportedCountries } = require('./lib/openai-supported-country-config');
const { loadRecommendedCountryConfig } = require('./lib/recommended-country-config');
const {
  getExchangeRates,
  getAllProviderSnapshots,
  getAllProviderStates,
  getLatestRefreshEvent,
  upsertServiceConfig,
} = require('./lib/db');

function createApp({ db, refreshController, countrySyncController }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  const recommendationFilePath = process.env.RECOMMENDED_COUNTRY_PATHS_FILE || './data/recommended-country-paths.txt';
  const openAiSupportedCountriesFilePath = process.env.OPENAI_SUPPORTED_COUNTRIES_FILE || './data/openai-supported-api-countries.txt';
  const openAiWhatsAppCountriesFilePath = process.env.OPENAI_WHATSAPP_COUNTRIES_FILE || './data/openai-supported-whatsapp-countries.txt';
  const adminRefreshToken = String(process.env.ADMIN_REFRESH_TOKEN || '').trim();
  const refreshIntervalMs = Number(process.env.REFRESH_INTERVAL_MS || 60000);
  const exposeProviderErrors = String(process.env.EXPOSE_PROVIDER_ERRORS || '').toLowerCase() === 'true';

  upsertServiceConfig(db, serviceConfig);

  function redactProviderError(message) {
    if (exposeProviderErrors) return message || '';
    return message ? '平台异常' : '';
  }

  function redactCompareRows(rows) {
    return rows.map((row) => ({
      ...row,
      offers: row.offers.map((offer) => ({
        ...offer,
        errorMessage: redactProviderError(offer.errorMessage),
      })),
    }));
  }

  function setApiCacheHeaders(res) {
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
  }

  app.get('/api/meta', (req, res) => {
    setApiCacheHeaders(res);
    const latestRefresh = getLatestRefreshEvent(db);
    const states = getAllProviderStates(db);
    const snapshots = new Map(getAllProviderSnapshots(db).map((snapshot) => [snapshot.providerKey, snapshot]));
    const usdRates = getExchangeRates(db, 'USD');
    const recommendationConfig = loadRecommendedCountryConfig(recommendationFilePath, serviceConfig.recommendedWhitelistIso2);
    const openAiSupportedCountries = loadOpenAiSupportedCountries(openAiSupportedCountriesFilePath);
    const openAiWhatsAppCountries = loadOpenAiSupportedCountries(openAiWhatsAppCountriesFilePath);
    const rawCountryListSync = countrySyncController?.getState?.() || {
      status: 'bundled',
      lastSuccessAt: '',
      errorMessage: '',
      apiCountryCount: openAiSupportedCountries.whitelist.length,
      whatsappCountryCount: openAiWhatsAppCountries.whitelist.length,
    };
    const countryListSync = {
      status: rawCountryListSync.status,
      lastAttemptAt: rawCountryListSync.lastAttemptAt || '',
      lastSuccessAt: rawCountryListSync.lastSuccessAt || '',
      errorMessage: rawCountryListSync.errorMessage ? '官网国家列表同步异常' : '',
      apiCountryCount: rawCountryListSync.apiCountryCount || openAiSupportedCountries.whitelist.length,
      whatsappCountryCount: rawCountryListSync.whatsappCountryCount || openAiWhatsAppCountries.whitelist.length,
      sources: rawCountryListSync.sources || {},
    };

    res.json({
      service: {
        serviceKey: serviceConfig.serviceKey,
        displayName: serviceConfig.displayName,
        bindWhitelistIso2: serviceConfig.bindWhitelistIso2,
        recommendedWhitelistIso2: recommendationConfig.whitelist,
        registerSupportedWhitelistIso2: openAiSupportedCountries.whitelist,
        whatsappSupportedWhitelistIso2: openAiWhatsAppCountries.whitelist,
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
      countryListSync,
      providers: serviceConfig.providerMappings.map((mapping) => {
        const state = states.get(mapping.providerKey);
        const snapshot = snapshots.get(mapping.providerKey);
        return {
          providerKey: mapping.providerKey,
          displayName: mapping.displayName,
          configured: Boolean(process.env[mapping.keyEnv] || mapping.providerKey === 'smsbower' || mapping.providerKey === '5sim'),
          status: state?.status || 'idle',
          lastAttemptedAt: state?.last_attempted_at || '',
          lastSuccessAt: state?.last_success_at || '',
          errorMessage: redactProviderError(state?.error_message),
          offerCount: snapshot?.payload?.offers?.length || 0,
        };
      }),
      lastRefresh: latestRefresh,
      refreshState: refreshController.getState().isRunning ? 'running' : 'idle',
    });
  });

  app.get('/api/compare', (req, res) => {
    setApiCacheHeaders(res);
    const filters = {
      mode: ['bind', 'recommended', 'whatsapp'].includes(String(req.query.mode))
        ? String(req.query.mode)
        : 'register',
      country: req.query.country || '',
      provider: req.query.provider || '',
      status: req.query.status || '',
      sort: req.query.sort || 'price_asc',
    };

    const snapshots = getAllProviderSnapshots(db);
    const providerStates = getAllProviderStates(db);
    const recommendationConfig = loadRecommendedCountryConfig(recommendationFilePath, serviceConfig.recommendedWhitelistIso2);
    const openAiSupportedCountries = loadOpenAiSupportedCountries(openAiSupportedCountriesFilePath);
    const openAiWhatsAppCountries = loadOpenAiSupportedCountries(openAiWhatsAppCountriesFilePath);
    const includeOffers = String(req.query.summary || '') !== '1';
    const rows = redactCompareRows(aggregateByCountry({
      snapshots,
      states: providerStates,
      filters,
      whitelist: serviceConfig.bindWhitelistIso2,
      recommendedWhitelist: recommendationConfig.whitelist,
      recommendationPathByIso2: recommendationConfig.pathByIso2,
      openAiSupportedWhitelist: openAiSupportedCountries.whitelist,
      whatsappSupportedWhitelist: openAiWhatsAppCountries.whitelist,
      includeOffers,
    }));

    const countries = rows.map((row) => ({
      iso2: row.countryIso2,
      name: row.countryName,
      displayName: row.countryDisplayName || row.countryName,
      chineseName: row.countryNameZh || row.countryName,
      englishName: row.countryNameEn || row.countryName,
      recommendationPath: row.recommendationPath,
    }));

    res.json({
      filters,
      recommendationConfig: {
        updatedAt: recommendationConfig.updatedAt,
        source: recommendationConfig.source,
      },
      countries,
      rows,
      updatedAt: getLatestRefreshEvent(db)?.completed_at || '',
    });
  });

  app.post('/api/refresh', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!adminRefreshToken) {
      res.status(503).json({
        accepted: false,
        reason: 'admin_refresh_not_configured',
      });
      return;
    }

    const providedToken = String(
      req.get('x-admin-refresh-token')
      || req.get('authorization')?.replace(/^Bearer\s+/i, '')
      || '',
    ).trim();

    if (providedToken !== adminRefreshToken) {
      res.status(403).json({
        accepted: false,
        reason: 'forbidden',
      });
      return;
    }

    const result = typeof refreshController.triggerRefresh === 'function'
      ? refreshController.triggerRefresh('manual')
      : await refreshController.refreshAll('manual');
    res.status(result.accepted ? 202 : 429).json(result);
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  const clientDist = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientDist, {
    setHeaders(res, filePath) {
      const relativePath = path.relative(clientDist, filePath);
      if (relativePath.startsWith(`assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (relativePath.startsWith(`fonts${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000');
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'), {
      headers: { 'Cache-Control': 'no-cache' },
    }, (error) => {
      if (error) next();
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof URIError || error?.type === 'entity.parse.failed' || error?.status === 400) {
      res.status(400).json({ error: 'bad_request' });
      return;
    }

    console.error(error);
    res.status(500).json({ error: 'internal_server_error' });
  });

  return app;
}

module.exports = {
  createApp,
};
