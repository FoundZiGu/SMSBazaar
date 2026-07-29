'use strict';

require('dotenv').config();

const serviceConfig = require('./config/service-config');
const { createApp } = require('./app');
const { createDatabase, upsertServiceConfig } = require('./lib/db');
const { createExchangeRateService } = require('./lib/exchange-rates');
const { createRefreshController } = require('./lib/refresh-controller');
const { createOpenAiCountrySync } = require('./lib/openai-country-sync');

const port = Number(process.env.PORT || 8787);
const refreshIntervalMs = Number(process.env.REFRESH_INTERVAL_MS || 120000);
const refreshCooldownMs = Number(process.env.REFRESH_COOLDOWN_MS || 30000);
const databasePath = process.env.DATABASE_PATH || './data/app.sqlite';
const exchangeRateUrl = process.env.EXCHANGE_RATE_URL || 'https://api.frankfurter.app/latest?from=USD';
const openAiSupportedCountriesFilePath = process.env.OPENAI_SUPPORTED_COUNTRIES_FILE || './data/openai-supported-api-countries.txt';
const openAiWhatsAppCountriesFilePath = process.env.OPENAI_WHATSAPP_COUNTRIES_FILE || './data/openai-supported-whatsapp-countries.txt';
const openAiCountrySyncStateFilePath = process.env.OPENAI_COUNTRY_SYNC_STATE_FILE || './data/openai-country-sync-state.json';

async function bootstrap() {
  const db = createDatabase(databasePath);
  upsertServiceConfig(db, serviceConfig);

  const exchangeRateService = createExchangeRateService({
    db,
    rateUrl: exchangeRateUrl,
  });

  const refreshController = createRefreshController({
    db,
    exchangeRateService,
    serviceConfig,
    refreshCooldownMs,
  });

  const countrySyncController = createOpenAiCountrySync({
    apiCountriesFilePath: openAiSupportedCountriesFilePath,
    whatsappCountriesFilePath: openAiWhatsAppCountriesFilePath,
    stateFilePath: openAiCountrySyncStateFilePath,
    syncIntervalMs: Number(process.env.OPENAI_COUNTRY_SYNC_INTERVAL_MS || 86400000),
    retryIntervalMs: Number(process.env.OPENAI_COUNTRY_SYNC_RETRY_MS || 3600000),
    checkIntervalMs: Number(process.env.OPENAI_COUNTRY_SYNC_CHECK_MS || 3600000),
    enabled: String(process.env.OPENAI_COUNTRY_SYNC_ENABLED || 'true').toLowerCase() !== 'false',
  });

  const app = createApp({
    db,
    refreshController,
    countrySyncController,
  });

  const server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });

  refreshController.refreshAll('startup').catch((error) => {
    console.error(`Initial refresh failed: ${error.message}`);
  });
  countrySyncController.start();

  const interval = setInterval(() => {
    refreshController.refreshAll('scheduled').catch((error) => {
      console.error(`Scheduled refresh failed: ${error.message}`);
    });
  }, refreshIntervalMs);

  const shutdown = () => {
    clearInterval(interval);
    countrySyncController.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
