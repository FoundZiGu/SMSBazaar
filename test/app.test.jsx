import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../client/src/App';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    global.fetch = vi.fn(async (url) => {
      if (url === '/api/meta') {
        return {
          ok: true,
          json: async () => ({
            service: {
              serviceKey: 'openai_chatgpt',
              displayName: 'OPENAI (ChatGPT)',
              bindWhitelistIso2: ['US'],
              recommendedWhitelistIso2: ['US'],
              registerSupportedWhitelistIso2: ['US', 'GB'],
            },
            modeCounts: {
              register: 2,
              bind: 1,
              recommended: 1,
            },
            display: {
              primaryCurrency: 'CNY',
              secondaryCurrency: 'USD',
              cnyRateFromUsd: 7.2,
              refreshIntervalMs: 60000,
            },
            providers: [
              {
                providerKey: 'smsbower',
                displayName: 'SMSBower',
                websiteUrl: 'https://smsbower.page/',
                status: 'success',
              },
            ],
            lastRefresh: { completed_at: '2026-05-27T12:00:00.000Z' },
            refreshState: 'idle',
          }),
        };
      }

      if (String(url).startsWith('/api/compare')) {
        const isSummary = String(url).includes('summary=1');
        const payload = {
          rows: [
            {
              countryIso2: 'GB',
              countryName: 'United Kingdom',
              countryNameZh: '英国',
              countryNameEn: 'United Kingdom',
              countryDisplayName: '英国 (United Kingdom)',
              providerCount: 1,
              inStockProviderCount: 1,
              inventoryTotal: 15,
              minPriceUsd: 0.05,
              minPriceOriginal: 0.05,
              cheapestCurrency: 'USD',
              cheapestProviderName: 'SMSBower',
              cheapestTierStock: 1,
              lastFetchedAt: '2026-05-27T12:00:00.000Z',
              offers: isSummary
                ? []
                : [
                    {
                      providerKey: 'smsbower',
                      providerName: 'SMSBower',
                      status: 'in_stock',
                      currency: 'USD',
                      minPriceOriginal: 0.05,
                      minPriceUsd: 0.05,
                      inventoryTotal: 15,
                      lastFetchedAt: '2026-05-27T12:00:00.000Z',
                      tiers: [{ priceOriginal: 0.05, priceUsd: 0.05, stock: 1, providerRef: '2295' }],
                      errorMessage: '',
                    },
                  ],
            },
            {
              countryIso2: 'US',
              countryName: 'United States',
              countryNameZh: '美国',
              countryNameEn: 'United States',
              countryDisplayName: '美国 (United States)',
              providerCount: 1,
              inStockProviderCount: 1,
              inventoryTotal: 9,
              minPriceUsd: 0.11,
              minPriceOriginal: 0.11,
              cheapestCurrency: 'USD',
              cheapestProviderName: 'SMSBower',
              cheapestTierStock: 9,
              lastFetchedAt: '2026-05-27T12:00:00.000Z',
              offers: isSummary
                ? []
                : [
                    {
                      providerKey: 'smsbower',
                      providerName: 'SMSBower',
                      status: 'in_stock',
                      currency: 'USD',
                      minPriceOriginal: 0.11,
                      minPriceUsd: 0.11,
                      inventoryTotal: 9,
                      lastFetchedAt: '2026-05-27T12:00:00.000Z',
                      tiers: [{ priceOriginal: 0.11, priceUsd: 0.11, stock: 9, providerRef: '2495' }],
                      errorMessage: '',
                    },
                  ],
            },
          ],
          countries: [
            { iso2: 'GB', name: 'United Kingdom' },
            { iso2: 'US', name: 'United States' },
          ],
          updatedAt: '2026-05-27T12:00:00.000Z',
        };

        return {
          ok: true,
          json: async () => payload,
        };
      }

      throw new Error(`Unhandled fetch for ${url}`);
    });
  });

  it('loads summary rows, displays low-stock tag, and lazily expands provider link & tiers', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'SMSBazaar' })).toBeInTheDocument();
    expect(screen.getByText('仅剩 1')).toBeInTheDocument();

    const rowButton = await screen.findByRole('button', { name: /United States/i });
    const initialCompareCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/compare'));
    expect(initialCompareCalls).toHaveLength(1);
    expect(initialCompareCalls[0][0]).toContain('summary=1');

    fireEvent.click(rowButton);
    const providerLink = await screen.findByRole('link', { name: /SMSBower/i });
    expect(providerLink).toHaveAttribute('href', 'https://smsbower.page/');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('country=US'));

    fireEvent.click(screen.getByRole('button', { name: /1 档/ }));
    expect(await screen.findByText('#2495')).toBeInTheDocument();
  });

  it('switches scope tabs, toggles minStock filter, and filters by provider', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /United States/i });

    fireEvent.click(screen.getByRole('tab', { name: /无 WhatsApp 国家/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('mode=bind'));
    });

    fireEvent.click(screen.getByRole('tab', { name: /推荐国家/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('mode=recommended'));
    });

    fireEvent.click(screen.getByRole('button', { name: /过滤 <10 库存档/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('minStock=10'));
    });

    fireEvent.click(screen.getByRole('button', { name: 'SMSBower' }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('provider=smsbower'));
    });
  });

  it('supports search aliases, favorites pinning, column sort, and currency toggle', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /United States/i });

    // Favorite US and verify favorite filter pill appears
    fireEvent.click(screen.getByRole('button', { name: '收藏 美国' }));
    expect(screen.getByRole('button', { name: /仅看收藏 \(1\)/ })).toBeInTheDocument();

    // Alias search: "uk" matches GB (英国)
    fireEvent.change(screen.getByLabelText('搜索国家'), { target: { value: 'uk' } });
    expect(screen.getByRole('button', { name: /United Kingdom/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /United States/i })).not.toBeInTheDocument();

    // Currency toggle
    fireEvent.click(screen.getByRole('button', { name: '$ USD' }));
    expect(screen.getAllByText('$0.05').length).toBeGreaterThan(0);

    // Clickable column header sort
    fireEvent.click(screen.getByRole('button', { name: /全网总库存/ }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('sort=stock_desc'));
    });
  });
});
