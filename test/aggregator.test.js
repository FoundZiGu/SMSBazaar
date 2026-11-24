import { describe, expect, it } from 'vitest';
import { aggregateByCountry, computeModeCountryCounts } from '../src/lib/aggregator';

describe('aggregateByCountry', () => {
  const snapshots = [
    {
      providerKey: 'smsbower',
      payload: {
        offers: [
          {
            providerKey: 'smsbower',
            providerName: 'SMSBower',
            countryIso2: 'US',
            countryName: 'United States',
            status: 'in_stock',
            currency: 'USD',
            minPriceOriginal: 0.1,
            minPriceUsd: 0.1,
            inventoryTotal: 12,
            tiers: [{ priceOriginal: 0.1, priceUsd: 0.1, stock: 12, providerRef: '' }],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
            errorMessage: '',
          },
        ],
      },
    },
    {
      providerKey: '5sim',
      payload: {
        offers: [
          {
            providerKey: '5sim',
            providerName: '5SIM',
            countryIso2: 'US',
            countryName: 'United States',
            status: 'in_stock',
            currency: 'USD',
            minPriceOriginal: 0.2,
            minPriceUsd: 0.2,
            inventoryTotal: 4,
            tiers: [{ priceOriginal: 0.2, priceUsd: 0.2, stock: 4, providerRef: 'virtual34' }],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
            errorMessage: '',
          },
          {
            providerKey: '5sim',
            providerName: '5SIM',
            countryIso2: 'JP',
            countryName: 'Japan',
            status: 'in_stock',
            currency: 'USD',
            minPriceOriginal: 0.3,
            minPriceUsd: 0.3,
            inventoryTotal: 8,
            tiers: [{ priceOriginal: 0.3, priceUsd: 0.3, stock: 8, providerRef: 'virtual21' }],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
            errorMessage: '',
          },
        ],
      },
    },
  ];

  const states = new Map([
    ['smsbower', { status: 'success', error_message: '' }],
    ['5sim', { status: 'error', error_message: '503 rate limited' }],
  ]);

  it('merges provider offers by country and keeps stale data on provider failure', () => {
    const rows = aggregateByCountry({
      snapshots,
      states,
      filters: { mode: 'register', country: '', provider: '', status: '', sort: 'price_asc' },
      whitelist: ['US'],
      recommendedWhitelist: ['JP'],
      recommendationPathByIso2: new Map([['US', 1], ['JP', 0]]),
      openAiSupportedWhitelist: ['US'],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].countryIso2).toBe('US');
    expect(rows[0].providerCount).toBe(2);
    expect(rows[0].inStockProviderCount).toBe(1);
    expect(rows[0].cheapestProviderName).toBe('SMSBower');
    expect(rows[0].inventoryTotal).toBe(16);
    expect(rows[0].recommendationPath).toBe(1);
    expect(rows[0].offers[1].status).toBe('stale');
    expect(rows[0].offers[1].errorMessage).toContain('503');
  });

  it('enforces bind whitelist and provider filters', () => {
    const rows = aggregateByCountry({
      snapshots,
      states,
      filters: { mode: 'bind', country: '', provider: 'smsbower', status: '', sort: 'price_asc' },
      whitelist: ['US'],
      recommendedWhitelist: ['JP'],
      recommendationPathByIso2: new Map([['US', 1], ['JP', 0]]),
      openAiSupportedWhitelist: ['US'],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].countryIso2).toBe('US');
    expect(rows[0].offers).toHaveLength(1);
    expect(rows[0].offers[0].providerKey).toBe('smsbower');
  });

  it('enforces recommended whitelist mode', () => {
    const rows = aggregateByCountry({
      snapshots,
      states,
      filters: { mode: 'recommended', country: '', provider: '', status: '', sort: 'price_asc' },
      whitelist: ['US'],
      recommendedWhitelist: ['JP'],
      recommendationPathByIso2: new Map([['US', 1], ['JP', 0]]),
      openAiSupportedWhitelist: ['US'],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].countryIso2).toBe('JP');
    expect(rows[0].recommendationPath).toBe(0);
  });

  it('enforces the OpenAI WhatsApp country whitelist', () => {
    const rows = aggregateByCountry({
      snapshots,
      states,
      filters: { mode: 'whatsapp', country: '', provider: '', status: '', sort: 'price_asc' },
      whatsappSupportedWhitelist: ['JP'],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].countryIso2).toBe('JP');
  });

  it('uses only in-stock tiers and providers for the country minimum price', () => {
    const priceSnapshots = [
      {
        providerKey: 'out-of-stock',
        payload: {
          offers: [{
            providerKey: 'out-of-stock',
            providerName: 'Out of stock',
            countryIso2: 'US',
            countryName: 'United States',
            status: 'out_of_stock',
            currency: 'USD',
            minPriceOriginal: 0.01,
            minPriceUsd: 0.01,
            inventoryTotal: 0,
            tiers: [{ priceOriginal: 0.01, priceUsd: 0.01, stock: 0, providerRef: '' }],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
          }],
        },
      },
      {
        providerKey: 'in-stock',
        payload: {
          offers: [{
            providerKey: 'in-stock',
            providerName: 'In stock',
            countryIso2: 'US',
            countryName: 'United States',
            status: 'in_stock',
            currency: 'USD',
            minPriceOriginal: 0.02,
            minPriceUsd: 0.02,
            inventoryTotal: 5,
            tiers: [
              { priceOriginal: 0.02, priceUsd: 0.02, stock: 0, providerRef: 'empty' },
              { priceOriginal: 0.15, priceUsd: 0.15, stock: 5, providerRef: 'available' },
            ],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
          }],
        },
      },
    ];

    const rows = aggregateByCountry({
      snapshots: priceSnapshots,
      states: new Map(),
      filters: { mode: 'register', country: '', provider: '', status: '', sort: 'price_asc' },
      openAiSupportedWhitelist: ['US'],
    });

    expect(rows[0].minPriceUsd).toBe(0.15);
    expect(rows[0].minPriceOriginal).toBe(0.15);
  });

  it('returns no country minimum price when every provider is out of stock', () => {
    const rows = aggregateByCountry({
      snapshots: [{
        providerKey: 'empty',
        payload: {
          offers: [{
            providerKey: 'empty',
            providerName: 'Empty',
            countryIso2: 'US',
            countryName: 'United States',
            status: 'out_of_stock',
            currency: 'USD',
            minPriceOriginal: 0.01,
            minPriceUsd: 0.01,
            inventoryTotal: 0,
            tiers: [{ priceOriginal: 0.01, priceUsd: 0.01, stock: 0, providerRef: '' }],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
          }],
        },
      }],
      states: new Map(),
      filters: { mode: 'register', country: '', provider: '', status: '', sort: 'price_asc' },
      openAiSupportedWhitelist: ['US'],
    });

    expect(rows[0].minPriceUsd).toBeNull();
  });

  it('marks a cached out-of-stock offer as stale when its provider fails', () => {
    const rows = aggregateByCountry({
      snapshots: [{
        providerKey: 'cached-provider',
        payload: {
          offers: [{
            providerKey: 'cached-provider',
            providerName: 'Cached provider',
            countryIso2: 'US',
            countryName: 'United States',
            status: 'out_of_stock',
            currency: 'USD',
            minPriceOriginal: 0.1,
            minPriceUsd: 0.1,
            inventoryTotal: 0,
            tiers: [{ priceOriginal: 0.1, priceUsd: 0.1, stock: 0, providerRef: '' }],
            lastFetchedAt: '2026-05-27T12:00:00.000Z',
          }],
        },
      }],
      states: new Map([['cached-provider', { status: 'error', error_message: 'rate limited' }]]),
      filters: { mode: 'register', country: '', provider: '', status: '', sort: 'price_asc' },
      openAiSupportedWhitelist: ['US'],
    });

    expect(rows[0].offers[0].status).toBe('stale');
  });

  it('skips low-stock bait tiers when minStock is set and reports cheapestTierStock', () => {
    const baitSnapshots = [{
      providerKey: 'smsbower',
      payload: {
        offers: [{
          providerKey: 'smsbower',
          providerName: 'SMSBower',
          countryIso2: 'JP',
          countryName: 'Japan',
          status: 'in_stock',
          currency: 'USD',
          minPriceOriginal: 0.135,
          minPriceUsd: 0.135,
          inventoryTotal: 9780,
          tiers: [
            { priceOriginal: 0.135, priceUsd: 0.135, stock: 1, providerRef: '3109' },
            { priceOriginal: 0.22, priceUsd: 0.22, stock: 9779, providerRef: '3160' },
          ],
          lastFetchedAt: '2026-05-27T12:00:00.000Z',
        }],
      },
    }];

    const rawRows = aggregateByCountry({
      snapshots: baitSnapshots,
      states: new Map(),
      filters: { mode: 'register', sort: 'price_asc', minStock: 0 },
      openAiSupportedWhitelist: ['JP'],
    });
    expect(rawRows[0].minPriceUsd).toBe(0.135);
    expect(rawRows[0].cheapestTierStock).toBe(1);

    const filteredRows = aggregateByCountry({
      snapshots: baitSnapshots,
      states: new Map(),
      filters: { mode: 'register', sort: 'price_asc', minStock: 10 },
      openAiSupportedWhitelist: ['JP'],
    });
    expect(filteredRows[0].minPriceUsd).toBe(0.22);
    expect(filteredRows[0].cheapestTierStock).toBe(9779);
  });

  it('computes exact per-mode country counts from active snapshots', () => {
    const counts = computeModeCountryCounts({
      snapshots,
      whitelist: ['US', 'MISSING'],
      recommendedWhitelist: ['JP', 'MISSING'],
      openAiSupportedWhitelist: ['US', 'JP', 'MISSING'],
      whatsappSupportedWhitelist: ['JP'],
    });
    expect(counts).toEqual({
      register: 2,
      bind: 1,
      recommended: 1,
      whatsapp: 1,
    });
  });
});
