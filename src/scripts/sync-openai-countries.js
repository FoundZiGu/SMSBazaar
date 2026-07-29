'use strict';

require('dotenv').config();

const { createOpenAiCountrySync } = require('../lib/openai-country-sync');

async function main() {
  const controller = createOpenAiCountrySync({
    apiCountriesFilePath: process.env.OPENAI_SUPPORTED_COUNTRIES_FILE
      || './data/openai-supported-api-countries.txt',
    whatsappCountriesFilePath: process.env.OPENAI_WHATSAPP_COUNTRIES_FILE
      || './data/openai-supported-whatsapp-countries.txt',
    stateFilePath: process.env.OPENAI_COUNTRY_SYNC_STATE_FILE
      || './data/openai-country-sync-state.json',
    enabled: true,
  });
  const result = await controller.runSync(true);
  const state = controller.getState();

  console.log(JSON.stringify({
    status: result.status,
    lastSuccessAt: state.lastSuccessAt,
    apiCountryCount: state.apiCountryCount,
    whatsappCountryCount: state.whatsappCountryCount,
    errorMessage: state.errorMessage,
  }, null, 2));

  if (result.status !== 'success') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
