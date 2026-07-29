import { describe, expect, it, vi } from 'vitest';
import { fetchProviderOffers as fetchFiveSim } from '../src/lib/providers/fivesim';
import { fetchProviderOffers as fetchNexSms } from '../src/lib/providers/nexsms';
import { fetchProviderOffers as fetchSmsVerification } from '../src/lib/providers/sms-verification-number';
import { fetchProviderOffers as fetchHero } from '../src/lib/providers/hero-sms';
import { fetchProviderOffers as fetchGrizzly } from '../src/lib/providers/grizzlysms';
import { fetchProviderOffers as fetchSmsPool } from '../src/lib/providers/smspool';
import { extractCountriesForService } from '../src/lib/providers/smsbower';

const exchangeRateService = {
  convertToUsd: async (amount) => Number(amount),
};

function mockFetchSequence(responses) {
  global.fetch = vi.fn();
  for (const response of responses) {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify(response),
    });
  }
}

describe('provider adapters', () => {
  it('parses smsbower country sheet', () => {
    const countries = extractCountriesForService({
      services: {
        '247': {
          countries: {
            1: {
              id: 1,
              iso: 'US',
              title: 'United States',
              positions: {
                1: { price: 0.25, count: 10, agent_ids: [11] },
              },
            },
          },
        },
      },
    }, 247);

    expect(countries).toHaveLength(1);
    expect(countries[0].iso).toBe('US');
    expect(countries[0].tiers[0].stock).toBe(10);
  });

  it('parses 5sim product prices', async () => {
    mockFetchSequence([
      {
        openai: {
          england: {
            virtual34: { cost: 0.12, count: 7, rate: 99.9 },
          },
        },
      },
    ]);

    const result = await fetchFiveSim({
      mapping: { providerKey: '5sim', displayName: '5SIM', serviceCode: 'openai', baseUrl: 'https://5sim.net/v1' },
      exchangeRateService,
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('GB');
    expect(result.offers[0].tiers[0].providerRef).toBe('virtual34');
  });

  it('parses nexsms country price map', async () => {
    mockFetchSequence([
      { data: [{ id: 1, name: 'United States' }] },
      { data: [{ code: 'dr', name: 'OpenAI (ChatGPT)' }] },
      { code: 0, data: { countryId: 1, countryName: 'United States', priceMap: { '0.12': 8, '0.16': 3 } } },
    ]);

    const result = await fetchNexSms({
      mapping: { providerKey: 'nexsms', displayName: 'NexSMS', serviceCode: 'dr', baseUrl: 'https://api.nexsms.net/api' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].tiers).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[2][0]).not.toContain('countryId=');
  });

  it('merges duplicate NexSMS country routes into one offer', async () => {
    mockFetchSequence([
      { data: [{ id: 11, name: 'Philippines' }, { id: 12, name: 'Philippines route 2' }] },
      { data: [{ code: 'dr', name: 'OpenAI (ChatGPT)' }] },
      {
        code: 0,
        data: [
          { countryId: 11, countryName: 'Philippines', priceMap: { '0.10': 8, '0.20': 3 } },
          { countryId: 12, countryName: 'Philippines', priceMap: { '0.10': 5, '0.30': 2 } },
        ],
      },
    ]);

    const result = await fetchNexSms({
      mapping: { providerKey: 'nexsms', displayName: 'NexSMS', serviceCode: 'dr', baseUrl: 'https://api.nexsms.net/api' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].countryIso2).toBe('PH');
    expect(result.offers[0].inventoryTotal).toBe(18);
    expect(result.offers[0].tiers).toEqual([
      { priceOriginal: 0.1, priceUsd: 0.1, stock: 13, providerRef: '' },
      { priceOriginal: 0.2, priceUsd: 0.2, stock: 3, providerRef: '' },
      { priceOriginal: 0.3, priceUsd: 0.3, stock: 2, providerRef: '' },
    ]);
  });

  it('parses sms-verification-number prices', async () => {
    mockFetchSequence([
      [{ id: 1, name: 'United States' }],
      [{ id: 'dr', name: 'ChatGPT (openAI.com)', price: 0.22, quantity: 15 }],
    ]);

    const result = await fetchSmsVerification({
      mapping: { providerKey: 'sms-verification-number', displayName: 'SMS Verification Number', serviceCode: 'dr', baseUrl: 'https://sms-verification-number.com/stubs/handler_api' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(result.error).toBe('');
    expect(result.offers[0].countryIso2).toBe('US');
  });

  it('parses activate-compatible providers', async () => {
    const originalHeroApiKey = process.env.HERO_SMS_API_KEY;
    mockFetchSequence([
      { 1: { eng: 'United States' } },
      { 1: { dr: { cost: 0.31, count: 4 } } },
    ]);
    const heroResult = await fetchHero({
      mapping: { providerKey: 'hero-sms', displayName: 'Hero SMS', serviceCode: 'dr', baseUrl: 'https://hero-sms.com/stubs/handler_api.php' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(heroResult.error).toBe('');
    expect(heroResult.offers[0].countryIso2).toBe('US');

    const compatiblePayload = {
      usa: {
        dr: {
          price: 0.31,
          count: 4,
        },
      },
    };

    mockFetchSequence([
      { 1: { eng: 'United States' } },
      compatiblePayload,
    ]);
    const grizzlyResult = await fetchGrizzly({
      mapping: { providerKey: 'grizzlysms', displayName: 'Grizzly SMS', serviceCode: 'dr', baseUrl: 'https://api.grizzlysms.com/stubs/handler_api.php' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(grizzlyResult.error).toBe('');

    mockFetchSequence([
      [
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 2,
          country_name: 'United Kingdom',
          short_name: 'GB',
          pool: 3,
          price: '0.07',
        },
      ],
      { success: 1, amount: 42 },
    ]);
    const poolResult = await fetchSmsPool({
      mapping: { providerKey: 'smspool', displayName: 'SMSPool', serviceCode: '671', baseUrl: 'https://api.smspool.net' },
      exchangeRateService,
      apiKey: 'key',
    });
    expect(poolResult.error).toBe('');
    expect(poolResult.offers[0].countryIso2).toBe('GB');
    expect(poolResult.offers[0].inventoryTotal).toBe(42);
    expect(poolResult.offers[0].tiers[0].providerRef).toBe('3');
    process.env.HERO_SMS_API_KEY = originalHeroApiKey;
  });

  it('reuses cached SMSPool stock outside the rolling batch', async () => {
    const previousStockBatchSize = process.env.SMSPOOL_STOCK_BATCH_SIZE;
    process.env.SMSPOOL_STOCK_BATCH_SIZE = '1';
    mockFetchSequence([
      [
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 68,
          country_name: 'Brazil',
          short_name: 'BR',
          pool: 12,
          price: '0.26',
        },
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
            country: 2,
            country_name: 'United Kingdom',
            short_name: 'GB',
            pool: 3,
            price: '0.07',
        },
      ],
      { success: 1, amount: 100 },
    ]);

    const poolResult = await fetchSmsPool({
      mapping: { providerKey: 'smspool', displayName: 'SMSPool', serviceCode: '671', baseUrl: 'https://api.smspool.net' },
      exchangeRateService,
      apiKey: 'key',
      previousSnapshot: {
        offers: [
          {
            countryIso2: 'BR',
            inventoryTotal: 900,
            lastFetchedAt: '2026-05-01T00:00:00.000Z',
              metadata: { stockFetchedAt: '2026-05-01T00:00:00.000Z' },
            },
            {
              countryIso2: 'GB',
              inventoryTotal: 800,
              tiers: [{ priceOriginal: 0.07, priceUsd: 0.07, stock: 800, providerRef: '3' }],
              lastFetchedAt: '2026-05-02T00:00:00.000Z',
              metadata: { stockFetchedAt: '2026-05-02T00:00:00.000Z' },
            },
        ],
      },
    });

    const br = poolResult.offers.find((offer) => offer.countryIso2 === 'BR');
    const gb = poolResult.offers.find((offer) => offer.countryIso2 === 'GB');
    expect(br.inventoryTotal).toBe(100);
    expect(br.metadata.stockRefreshStatus).toBe('refreshed');
    expect(gb.inventoryTotal).toBe(800);
    expect(gb.metadata.stockRefreshStatus).toBe('cached');
    expect(gb.status).toBe('in_stock');
    if (previousStockBatchSize === undefined) {
      delete process.env.SMSPOOL_STOCK_BATCH_SIZE;
    } else {
      process.env.SMSPOOL_STOCK_BATCH_SIZE = previousStockBatchSize;
    }
  });

  it('keeps real low-price SMSPool pools when they have stock', async () => {
    mockFetchSequence([
      [
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 12,
          country_name: 'Philippines',
          short_name: 'PH',
          pool: 3,
          price: '0.02',
        },
        {
          service: 671,
          service_name: 'OpenAI / ChatGPT',
          country: 12,
          country_name: 'Philippines',
          short_name: 'PH',
          pool: 7,
          price: '0.04',
        },
      ],
      { success: 1, amount: 5685 },
      { success: 1, amount: 0 },
    ]);

    const poolResult = await fetchSmsPool({
      mapping: { providerKey: 'smspool', displayName: 'SMSPool', serviceCode: '671', baseUrl: 'https://api.smspool.net' },
      exchangeRateService,
      apiKey: 'key',
    });

    expect(poolResult.error).toBe('');
    expect(poolResult.offers[0].countryIso2).toBe('PH');
    expect(poolResult.offers[0].minPriceOriginal).toBe(0.02);
    expect(poolResult.offers[0].inventoryTotal).toBe(5685);
    expect(poolResult.offers[0].tiers[0]).toMatchObject({
      priceOriginal: 0.02,
      stock: 5685,
      providerRef: '3',
    });
  });
});
