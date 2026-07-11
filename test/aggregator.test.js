import { describe, expect, it } from 'vitest';
import { aggregateByCountry } from '../src/lib/aggregator';

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
});
