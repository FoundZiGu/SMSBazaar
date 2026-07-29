'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getIso2FromName, toCountryInfo } = require('./country-normalizer');

const API_COUNTRIES_URL = 'https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories';
const WHATSAPP_COUNTRIES_URL = 'https://help.openai.com/en/articles/8983038-which-countries-do-you-support-for-whatsapp-phone-verification';

const API_COUNTRY_ALIASES = new Map([
  ['brunei', 'BN'],
  ['cabo verde', 'CV'],
  ['congo (brazzaville)', 'CG'],
  ['congo (drc)', 'CD'],
  ['czechia (czech republic)', 'CZ'],
  ['eswatini (swaziland)', 'SZ'],
  ['holy see (vatican city)', 'VA'],
  ['micronesia', 'FM'],
  ['moldova', 'MD'],
  ['palestine', 'PS'],
  ['sao tome and principe', 'ST'],
  ['timor-leste (east timor)', 'TL'],
  ['ukraine (with certain exceptions)', 'UA'],
]);

function findBrowserExecutable() {
  const configuredPath = String(process.env.PUPPETEER_EXECUTABLE_PATH || '').trim();
  if (configuredPath) return configuredPath;

  return [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find((candidate) => fs.existsSync(candidate)) || '';
}

function normalizeEntry(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function uniqueIso2(values) {
  return Array.from(new Set(values));
}

function parseApiCountryEntries(entries) {
  const iso2List = [];
  const unresolved = [];

  for (const value of entries || []) {
    const name = normalizeEntry(value);
    if (!name) continue;
    const iso2 = API_COUNTRY_ALIASES.get(name.toLowerCase()) || getIso2FromName(name);
    if (!iso2) {
      unresolved.push(name);
      continue;
    }
    iso2List.push(iso2);
  }

  if (unresolved.length) {
    throw new Error(`Unrecognized OpenAI API countries: ${unresolved.join(', ')}`);
  }

  const whitelist = uniqueIso2(iso2List);
  if (whitelist.length < 150) {
    throw new Error(`OpenAI API country list is unexpectedly short: ${whitelist.length}`);
  }
  return whitelist;
}

function parseWhatsAppCountryEntries(entries) {
  const iso2List = [];
  const unresolved = [];

  for (const value of entries || []) {
    const entry = normalizeEntry(value);
    if (!entry) continue;
    const match = entry.match(/^([A-Z]{2})\s*:/i);
    const iso2 = match ? match[1].toUpperCase() : '';
    if (!iso2 || toCountryInfo(iso2).iso2 !== iso2) {
      unresolved.push(entry);
      continue;
    }
    iso2List.push(iso2);
  }

  if (unresolved.length) {
    throw new Error(`Unrecognized OpenAI WhatsApp countries: ${unresolved.join(', ')}`);
  }

  const whitelist = uniqueIso2(iso2List);
  if (whitelist.length < 5) {
    throw new Error(`OpenAI WhatsApp country list is unexpectedly short: ${whitelist.length}`);
  }
  return whitelist;
}

function serializeCountryFile(title, sourceUrl, whitelist, syncedAt) {
  return [
    `# ${title}`,
    `# Source: ${sourceUrl}`,
    `# Synced at: ${syncedAt}`,
    '# One ISO2 code per line.',
    ...whitelist,
    '',
  ].join('\n');
}

function writeFileAtomically(filePath, content) {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const temporaryPath = `${resolvedPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, content, 'utf8');
    fs.renameSync(temporaryPath, resolvedPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return null;
  }
}

function createOpenAiCountrySync({
  apiCountriesFilePath,
  whatsappCountriesFilePath,
  stateFilePath,
  syncIntervalMs = 86400000,
  retryIntervalMs = 3600000,
  checkIntervalMs = 3600000,
  enabled = true,
  launchBrowser,
}) {
  const resolvedStatePath = path.resolve(stateFilePath);
  let state = {
    status: enabled ? 'idle' : 'disabled',
    lastAttemptAt: '',
    lastSuccessAt: '',
    errorMessage: '',
    apiCountryCount: 0,
    whatsappCountryCount: 0,
    ...(readJsonFile(resolvedStatePath) || {}),
  };
  if (!enabled) state.status = 'disabled';
  let timer = null;
  let currentPromise = null;

  function saveState() {
    writeFileAtomically(resolvedStatePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  function getState() {
    return {
      ...state,
      sources: {
        api: API_COUNTRIES_URL,
        whatsapp: WHATSAPP_COUNTRIES_URL,
      },
    };
  }

  function isDue(force) {
    if (force) return true;
    const now = Date.now();
    const lastSuccessMs = new Date(state.lastSuccessAt || 0).getTime();
    if (Number.isFinite(lastSuccessMs) && now - lastSuccessMs < syncIntervalMs) return false;
    const lastAttemptMs = new Date(state.lastAttemptAt || 0).getTime();
    return !Number.isFinite(lastAttemptMs) || now - lastAttemptMs >= retryIntervalMs;
  }

  async function readArticleEntries(page, url) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('article .article-content li', { timeout: 60000 });
    return page.$$eval('article .article-content li', (items) => items
      .map((item) => String(item.textContent || '').trim())
      .filter(Boolean));
  }

  async function runSync(force = false) {
    if (!enabled) return { accepted: false, reason: 'disabled' };
    if (currentPromise) return currentPromise;
    if (!isDue(force)) return { accepted: false, reason: 'not_due' };

    currentPromise = (async () => {
      state = {
        ...state,
        status: 'running',
        lastAttemptAt: new Date().toISOString(),
        errorMessage: '',
      };
      saveState();

      let browser;
      try {
        const executablePath = findBrowserExecutable();
        if (!launchBrowser && !executablePath) {
          throw new Error('No Chrome or Chromium executable was found');
        }
        const launchOptions = {
          headless: true,
          ...(executablePath ? { executablePath } : {}),
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
          ],
        };
        browser = launchBrowser
          ? await launchBrowser(launchOptions)
          : await require('puppeteer-core').launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

        const apiEntries = await readArticleEntries(page, API_COUNTRIES_URL);
        const whatsappEntries = await readArticleEntries(page, WHATSAPP_COUNTRIES_URL);
        const apiWhitelist = parseApiCountryEntries(apiEntries);
        const whatsappWhitelist = parseWhatsAppCountryEntries(whatsappEntries);
        const syncedAt = new Date().toISOString();

        writeFileAtomically(apiCountriesFilePath, serializeCountryFile(
          'OpenAI API - Supported Countries and Territories',
          API_COUNTRIES_URL,
          apiWhitelist,
          syncedAt,
        ));
        writeFileAtomically(whatsappCountriesFilePath, serializeCountryFile(
          'OpenAI WhatsApp Phone Verification - Supported Countries',
          WHATSAPP_COUNTRIES_URL,
          whatsappWhitelist,
          syncedAt,
        ));

        state = {
          status: 'success',
          lastAttemptAt: state.lastAttemptAt,
          lastSuccessAt: syncedAt,
          errorMessage: '',
          apiCountryCount: apiWhitelist.length,
          whatsappCountryCount: whatsappWhitelist.length,
        };
        saveState();
        return { accepted: true, status: 'success', ...getState() };
      } catch (error) {
        state = {
          ...state,
          status: 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
        };
        saveState();
        return { accepted: true, status: 'error', error: state.errorMessage };
      } finally {
        if (browser) await browser.close().catch(() => {});
        currentPromise = null;
      }
    })();

    return currentPromise;
  }

  function start() {
    if (!enabled || timer) return;
    runSync(false).then((result) => {
      if (result.status === 'error') console.error(`OpenAI country sync failed: ${result.error}`);
    }).catch((error) => console.error(`OpenAI country sync failed: ${error.message}`));
    timer = setInterval(() => {
      runSync(false).then((result) => {
        if (result.status === 'error') console.error(`OpenAI country sync failed: ${result.error}`);
      }).catch((error) => console.error(`OpenAI country sync failed: ${error.message}`));
    }, checkIntervalMs);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    getState,
    runSync,
    start,
    stop,
  };
}

module.exports = {
  API_COUNTRIES_URL,
  WHATSAPP_COUNTRIES_URL,
  createOpenAiCountrySync,
  parseApiCountryEntries,
  parseWhatsAppCountryEntries,
  serializeCountryFile,
};
