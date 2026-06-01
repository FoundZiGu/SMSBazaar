'use strict';

const { createProviderError, makeOffer } = require('./helpers');
const { request } = require('../http');

function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || 'https://api.smspool.net').trim();
  if (!raw || raw.includes('/stubs/handler_api')) return 'https://api.smspool.net';
  return raw.replace(/\/+$/, '');
}

function parseJson(text, endpoint) {
  try {
    return JSON.parse(text);
  } catch (error) {
    error.message = `Failed to parse SMSPool ${endpoint} response: ${error.message}`;
    throw error;
  }
}

async function postJson(baseUrl, endpoint, params = {}) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    body.set(key, String(value));
  }

  const response = await request(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  return parseJson(response.text, endpoint);
}

async function mapWithConcurrency(items, limit, iteratee) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await iteratee(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function isNumericServiceCode(serviceCode) {
  return /^\d+$/.test(String(serviceCode || '').trim());
}

function findNativeServiceId(services, mapping) {
  const configuredName = String(mapping.nativeServiceName || '').trim().toLowerCase();
  const fallbackPattern = /openai|chatgpt/i;

  const exact = services.find((service) => (
    configuredName
      && String(service.name || service.service_name || '').trim().toLowerCase() === configuredName
  ));
  if (exact) return String(exact.ID || exact.id || exact.service || '');

  const fuzzy = services.find((service) => (
    fallbackPattern.test(String(service.name || service.service_name || service.title || ''))
  ));
  return fuzzy ? String(fuzzy.ID || fuzzy.id || fuzzy.service || '') : '';
}

async function resolveServiceId(baseUrl, mapping) {
  if (isNumericServiceCode(mapping.serviceCode)) {
    return String(mapping.serviceCode).trim();
  }

  const services = await postJson(baseUrl, '/service/retrieve_all');
  const serviceList = Array.isArray(services) ? services : [];
  const serviceId = findNativeServiceId(serviceList, mapping);
  if (!serviceId) {
    throw new Error(`SMSPool native service not found for ${mapping.serviceCode || mapping.nativeServiceName || 'OpenAI / ChatGPT'}`);
  }
  return serviceId;
}

function groupPricingByCountry(pricingRows) {
  const countries = new Map();

  for (const row of pricingRows || []) {
    const price = Number(row.price || row.cost || 0);
    // Filter out abnormal, non-purchasable empty test pools (under 0.03 USD)
    if (price < 0.03) continue;

    const countryId = String(row.country || row.country_id || '').trim();
    if (!countryId) continue;

    const country = countries.get(countryId) || {
      countryId,
      countryIso2: String(row.short_name || row.iso || '').trim().toUpperCase(),
      countryName: String(row.country_name || row.name || countryId).trim(),
      tiers: [],
    };

    country.tiers.push({
      pool: String(row.pool || row.pool_id || '').trim(),
      priceOriginal: Number(row.price || row.cost || 0),
      stock: 0,
      providerRef: String(row.pool || row.pool_id || '').trim(),
    });
    countries.set(countryId, country);
  }

  return Array.from(countries.values());
}

function getPreviousOfferMap(previousSnapshot) {
  const offers = Array.isArray(previousSnapshot?.offers) ? previousSnapshot.offers : [];
  return new Map(offers
    .filter((offer) => offer.countryIso2)
    .map((offer) => [offer.countryIso2, offer]));
}

function getNextStockBatch(countries, previousOfferMap, batchSize) {
  return countries
    .slice()
    .sort((left, right) => {
      const leftOffer = previousOfferMap.get(left.countryIso2);
      const rightOffer = previousOfferMap.get(right.countryIso2);
      const leftFetchedAt = leftOffer?.metadata?.stockFetchedAt || '';
      const rightFetchedAt = rightOffer?.metadata?.stockFetchedAt || '';
      return leftFetchedAt.localeCompare(rightFetchedAt) || left.countryIso2.localeCompare(right.countryIso2);
    })
    .slice(0, batchSize);
}

function getPreviousStock(previousOffer) {
  if (!previousOffer) return {
    inventoryTotal: 0,
    stockFetchedAt: '',
  };

  return {
    inventoryTotal: Number(previousOffer.inventoryTotal || 0),
    stockFetchedAt: previousOffer.metadata?.stockFetchedAt || previousOffer.lastFetchedAt || '',
  };
}

async function fetchPoolNames(baseUrl, countryId, serviceId) {
  try {
    const payload = await postJson(baseUrl, '/pool/retrieve_valid', {
      country: countryId,
      service: serviceId,
      web: 1,
    });
    return new Map(Object.entries(payload || {}).map(([poolId, poolName]) => [String(poolId), String(poolName)]));
  } catch (error) {
    return new Map();
  }
}

async function fetchStock(baseUrl, apiKey, countryId, serviceId, pool = '') {
  const payload = await postJson(baseUrl, '/sms/stock', {
    key: apiKey,
    country: countryId,
    service: serviceId,
    pool,
  });

  if (Number(payload?.success) === 0) {
    throw new Error(payload?.message || 'SMSPool stock request failed');
  }

  return Number(payload?.amount || 0);
}

async function fetchStockSafely(baseUrl, apiKey, countryId, serviceId, pool = '') {
  try {
    return {
      stock: await fetchStock(baseUrl, apiKey, countryId, serviceId, pool),
      errorMessage: '',
    };
  } catch (error) {
    return {
      stock: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchProviderOffers({
  mapping,
  exchangeRateService,
  apiKey,
  previousSnapshot,
}) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }

    const baseUrl = normalizeBaseUrl(mapping.baseUrl);
    const serviceId = await resolveServiceId(baseUrl, mapping);
    const pricingPayload = await postJson(baseUrl, '/request/pricing', {
      key: apiKey,
      service: serviceId,
    });
    const countries = groupPricingByCountry(Array.isArray(pricingPayload) ? pricingPayload : []);
    const now = new Date().toISOString();
    const includePoolNames = String(process.env.SMSPOOL_INCLUDE_POOL_NAMES || '').toLowerCase() === 'true';
    const stockMode = String(process.env.SMSPOOL_STOCK_MODE || 'country').toLowerCase();
    const stockBatchSize = Math.max(1, Number(process.env.SMSPOOL_STOCK_BATCH_SIZE || 20));
    const previousOfferMap = getPreviousOfferMap(previousSnapshot);
    const stockBatch = new Set(getNextStockBatch(countries, previousOfferMap, stockBatchSize)
      .map((country) => country.countryIso2));

    const offers = await mapWithConcurrency(countries, 3, async (country) => {
      const poolNames = includePoolNames
        ? await fetchPoolNames(baseUrl, country.countryId, serviceId)
        : new Map();
      const sortedTiers = country.tiers
        .slice()
        .sort((left, right) => left.priceOriginal - right.priceOriginal);
      const tiers = stockMode === 'pool'
        ? await mapWithConcurrency(sortedTiers, 2, async (tier) => {
          const poolName = poolNames.get(tier.pool);
          const stockResult = stockBatch.has(country.countryIso2)
            ? await fetchStockSafely(baseUrl, apiKey, country.countryId, serviceId, tier.pool)
            : { stock: 0, errorMessage: '' };
          return {
            priceOriginal: tier.priceOriginal,
            stock: stockResult.stock,
            providerRef: poolName ? `${tier.pool} ${poolName}` : tier.providerRef,
            stockErrorMessage: stockResult.errorMessage,
          };
        })
        : sortedTiers.map((tier, index) => {
          const poolName = poolNames.get(tier.pool);
          const providerRef = poolName ? `${tier.pool} ${poolName}` : tier.providerRef;
          return {
            priceOriginal: tier.priceOriginal,
            stock: 0,
            providerRef: index === 0 ? `${providerRef} / total stock` : providerRef,
          };
        });

      const previousOffer = previousOfferMap.get(country.countryIso2);
      const previousStock = getPreviousStock(previousOffer);
      let inventoryTotal = previousStock.inventoryTotal;
      let stockFetchedAt = previousStock.stockFetchedAt;
      let stockErrorMessage = '';

      if (stockMode !== 'pool' && tiers.length > 0) {
        if (stockBatch.has(country.countryIso2)) {
          const stockResult = await fetchStockSafely(baseUrl, apiKey, country.countryId, serviceId);
          inventoryTotal = stockResult.stock;
          stockFetchedAt = stockResult.errorMessage ? stockFetchedAt : now;
          stockErrorMessage = stockResult.errorMessage;
        }
        tiers[0].stock = inventoryTotal;
        tiers[0].providerRef = stockBatch.has(country.countryIso2)
          ? tiers[0].providerRef
          : `${tiers[0].providerRef} / cached stock`;
      }
      if (stockMode === 'pool') {
        stockErrorMessage = tiers.find((tier) => tier.stockErrorMessage)?.stockErrorMessage || '';
      }
      const status = inventoryTotal > 0 ? 'in_stock' : 'out_of_stock';

      return makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: country.countryIso2 || country.countryName,
        countryName: country.countryName,
        currency: 'USD',
        tiers,
        exchangeRateService,
        lastFetchedAt: now,
        status,
        errorMessage: '',
        metadata: {
          nativeServiceId: serviceId,
          nativeCountryId: country.countryId,
          stockFetchedAt,
          stockRefreshStatus: stockErrorMessage ? 'failed' : (stockBatch.has(country.countryIso2) ? 'refreshed' : 'cached'),
        },
      });
    });

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers: offers.filter((offer) => offer.countryIso2),
      error: '',
    };
  } catch (error) {
    return createProviderError(mapping.providerKey, mapping.displayName, error);
  }
}

module.exports = {
  fetchProviderOffers,
  groupPricingByCountry,
  normalizeBaseUrl,
};
