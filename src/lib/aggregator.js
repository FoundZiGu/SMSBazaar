'use strict';

function applyStateToOffer(offer, providerState) {
  if (!providerState) return offer;
  if (providerState.status === 'success') return offer;
  return {
    ...offer,
    status: 'stale',
    errorMessage: providerState.error_message || offer.errorMessage || '',
  };
}

function getInStockPrice(offer) {
  if (Number(offer.inventoryTotal || 0) <= 0) return null;

  const inStockTiers = (offer.tiers || [])
    .filter((tier) => Number(tier.stock || 0) > 0 && Number.isFinite(Number(tier.priceUsd)))
    .sort((left, right) => Number(left.priceUsd) - Number(right.priceUsd));
  const cheapestTier = inStockTiers[0];

  if (cheapestTier) {
    return {
      minPriceUsd: Number(cheapestTier.priceUsd),
      minPriceOriginal: Number(cheapestTier.priceOriginal || 0),
    };
  }

  if (!Number.isFinite(Number(offer.minPriceUsd))) return null;
  return {
    minPriceUsd: Number(offer.minPriceUsd),
    minPriceOriginal: Number(offer.minPriceOriginal || 0),
  };
}

function comparePrices(leftPrice, rightPrice, direction = 'asc') {
  const leftMissing = leftPrice === null || !Number.isFinite(Number(leftPrice));
  const rightMissing = rightPrice === null || !Number.isFinite(Number(rightPrice));
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return direction === 'desc'
    ? Number(rightPrice) - Number(leftPrice)
    : Number(leftPrice) - Number(rightPrice);
}

function aggregateByCountry({
  snapshots,
  states,
  filters,
  whitelist,
  recommendedWhitelist,
  recommendationPathByIso2,
  openAiSupportedWhitelist,
}) {
  const rows = new Map();
  const providerFilter = filters.provider ? String(filters.provider).toLowerCase() : '';
  const countryFilter = filters.country ? String(filters.country).toUpperCase() : '';
  const statusFilter = filters.status ? String(filters.status).toLowerCase() : '';
  const whitelistSet = new Set((whitelist || []).map((value) => String(value).toUpperCase()));
  const recommendedSet = new Set((recommendedWhitelist || []).map((value) => String(value).toUpperCase()));
  const recommendationMap = recommendationPathByIso2 || new Map();
  const openAiSupportedSet = new Set((openAiSupportedWhitelist || []).map((value) => String(value).toUpperCase()));

  for (const snapshot of snapshots) {
    const providerState = states.get(snapshot.providerKey);
    for (const offer of snapshot.payload.offers || []) {
      const materializedOffer = applyStateToOffer(offer, providerState);
      if (!materializedOffer.countryIso2) continue;
      if (filters.mode === 'register' && openAiSupportedSet.size > 0 && !openAiSupportedSet.has(materializedOffer.countryIso2)) continue;
      if (filters.mode === 'bind' && !whitelistSet.has(materializedOffer.countryIso2)) continue;
      if (filters.mode === 'recommended' && !recommendedSet.has(materializedOffer.countryIso2)) continue;
      if (countryFilter && materializedOffer.countryIso2 !== countryFilter) continue;
      if (providerFilter && materializedOffer.providerKey.toLowerCase() !== providerFilter) continue;
      if (statusFilter && materializedOffer.status.toLowerCase() !== statusFilter) continue;

      const current = rows.get(materializedOffer.countryIso2) || {
        countryIso2: materializedOffer.countryIso2,
        countryName: materializedOffer.countryName,
        countryNameEn: materializedOffer.countryNameEn,
        countryNameZh: materializedOffer.countryNameZh,
        countryDisplayName: materializedOffer.countryDisplayName || materializedOffer.countryName,
        recommendationPath: recommendationMap.has(materializedOffer.countryIso2)
          ? recommendationMap.get(materializedOffer.countryIso2)
          : null,
        providerCount: 0,
        inventoryTotal: 0,
        minPriceUsd: Number.POSITIVE_INFINITY,
        minPriceOriginal: 0,
        cheapestCurrency: '',
        lastFetchedAt: '',
        offers: [],
      };
      current.providerCount += 1;
      current.inventoryTotal += Number(materializedOffer.inventoryTotal || 0);
      const inStockPrice = getInStockPrice(materializedOffer);
      if (inStockPrice && inStockPrice.minPriceUsd < current.minPriceUsd) {
        current.minPriceUsd = inStockPrice.minPriceUsd;
        current.minPriceOriginal = inStockPrice.minPriceOriginal;
        current.cheapestCurrency = materializedOffer.currency;
      }
      if (!current.lastFetchedAt || materializedOffer.lastFetchedAt > current.lastFetchedAt) {
        current.lastFetchedAt = materializedOffer.lastFetchedAt;
      }
      current.offers.push(materializedOffer);
      rows.set(materializedOffer.countryIso2, current);
    }
  }

  const values = Array.from(rows.values()).map((row) => ({
    ...row,
    minPriceUsd: Number.isFinite(row.minPriceUsd) ? row.minPriceUsd : null,
    offers: row.offers.sort((left, right) => left.minPriceUsd - right.minPriceUsd || right.inventoryTotal - left.inventoryTotal),
  }));

  const sort = filters.sort || 'price_asc';
  values.sort((left, right) => {
    if (sort === 'price_desc') return comparePrices(left.minPriceUsd, right.minPriceUsd, 'desc') || right.inventoryTotal - left.inventoryTotal;
    if (sort === 'stock_desc') return right.inventoryTotal - left.inventoryTotal || comparePrices(left.minPriceUsd, right.minPriceUsd);
    return comparePrices(left.minPriceUsd, right.minPriceUsd) || right.inventoryTotal - left.inventoryTotal;
  });
  return values;
}

module.exports = {
  aggregateByCountry,
};
