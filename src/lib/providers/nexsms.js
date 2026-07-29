'use strict';

const { buildUrl, createProviderError, getJson, makeOffer } = require('./helpers');

function mergeTiersByPrice(tiers) {
  const byPrice = new Map();

  for (const tier of tiers || []) {
    const price = Number(tier.priceOriginal || 0);
    const key = price.toFixed(8);
    const current = byPrice.get(key) || {
      priceOriginal: price,
      stock: 0,
      providerRef: '',
    };
    current.stock += Number(tier.stock || 0);
    byPrice.set(key, current);
  }

  return Array.from(byPrice.values())
    .sort((left, right) => left.priceOriginal - right.priceOriginal);
}

async function mergeOffersByCountry(offers, exchangeRateService) {
  const grouped = new Map();

  for (const offer of offers) {
    const current = grouped.get(offer.countryIso2) || {
      base: offer,
      tiers: [],
      countryIds: [],
      lastFetchedAt: offer.lastFetchedAt,
    };
    current.tiers.push(...(offer.tiers || []));
    if (offer.metadata?.countryId !== undefined && offer.metadata?.countryId !== null) {
      current.countryIds.push(offer.metadata.countryId);
    }
    if (offer.lastFetchedAt > current.lastFetchedAt) current.lastFetchedAt = offer.lastFetchedAt;
    grouped.set(offer.countryIso2, current);
  }

  const merged = [];
  for (const group of grouped.values()) {
    merged.push(await makeOffer({
      providerKey: group.base.providerKey,
      providerName: group.base.providerName,
      countryValue: group.base.countryIso2,
      countryName: group.base.countryNameEn || group.base.countryName,
      currency: group.base.currency,
      tiers: mergeTiersByPrice(group.tiers),
      exchangeRateService,
      lastFetchedAt: group.lastFetchedAt,
      metadata: {
        countryIds: Array.from(new Set(group.countryIds)),
      },
    }));
  }

  return merged;
}

function getSuccessfulData(payload, endpointName) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(`NexSMS ${endpointName} returned an empty response`);
  }
  if ('code' in payload && Number(payload.code) !== 0) {
    throw new Error(`NexSMS ${endpointName} failed: ${payload.message || payload.code}`);
  }
  return payload.data;
}

function normalizePriceRows(payload) {
  const data = getSuccessfulData(payload, 'price list');
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.list)) return data.list;
  if (data.priceMap) return [data];

  return Object.entries(data)
    .filter(([, row]) => row && typeof row === 'object' && row.priceMap)
    .map(([countryId, row]) => ({
      countryId: row.countryId ?? countryId,
      ...row,
    }));
}

async function fetchProviderOffers({ mapping, exchangeRateService, apiKey }) {
  try {
    if (!apiKey) {
      throw new Error('Missing API key');
    }

    const countriesPayload = await getJson(buildUrl(`${mapping.baseUrl}/countries`, { apiKey }));
    const servicesPayload = await getJson(buildUrl(`${mapping.baseUrl}/services`, { apiKey }));
    const countries = getSuccessfulData(countriesPayload, 'countries');
    const services = getSuccessfulData(servicesPayload, 'services');
    const service = (Array.isArray(services) ? services : [])
      .find((entry) => String(entry.code).toLowerCase() === String(mapping.serviceCode).toLowerCase());
    if (!service) {
      throw new Error(`NexSMS service not found: ${mapping.serviceCode}`);
    }

    const pricesPayload = await getJson(buildUrl(`${mapping.baseUrl}/getCountryByService`, {
      apiKey,
      serviceCode: mapping.serviceCode,
    }));
    const priceRows = normalizePriceRows(pricesPayload);
    if (!priceRows.length) {
      throw new Error(`NexSMS returned no prices for service: ${mapping.serviceCode}`);
    }

    const countryLookup = new Map((Array.isArray(countries) ? countries : [])
      .map((country) => [String(country.id), country.name]));
    const now = new Date().toISOString();
    const offers = [];
    for (const data of priceRows) {
      if (!data?.priceMap) continue;
      const countryId = data.countryId ?? data.id;
      const countryName = data.countryName || countryLookup.get(String(countryId)) || String(countryId || '');
      const tiers = Object.entries(data.priceMap).map(([price, stock]) => ({
        priceOriginal: Number(price),
        stock: Number(stock || 0),
        providerRef: '',
      }));

      offers.push(await makeOffer({
        providerKey: mapping.providerKey,
        providerName: mapping.displayName,
        countryValue: countryName,
        countryName,
        currency: 'USD',
        tiers,
        exchangeRateService,
        lastFetchedAt: now,
        metadata: {
          countryId,
        },
      }));
    }

    return {
      providerKey: mapping.providerKey,
      providerName: mapping.displayName,
      offers: await mergeOffersByCountry(offers, exchangeRateService),
      error: '',
    };
  } catch (error) {
    return createProviderError(mapping.providerKey, mapping.displayName, error);
  }
}

module.exports = {
  fetchProviderOffers,
  normalizePriceRows,
  mergeOffersByCountry,
  mergeTiersByPrice,
};
