import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../client/src/App';

describe('App', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (url, options) => {
      if (url === '/api/meta') {
        return {
          ok: true,
          json: async () => ({
            service: {
              serviceKey: 'openai_chatgpt',
              displayName: 'OPENAI (ChatGPT)',
              bindWhitelistIso2: ['US'],
            },
            providers: [
              { providerKey: 'smsbower', displayName: 'SMSBower', status: 'success' },
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
              countryIso2: 'US',
              countryName: 'United States',
              providerCount: 1,
              inventoryTotal: 9,
              minPriceUsd: 0.11,
              minPriceOriginal: 0.11,
              cheapestCurrency: 'USD',
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
                      tiers: [{ priceOriginal: 0.11, priceUsd: 0.11, stock: 9, providerRef: '' }],
                      errorMessage: '',
                    },
                  ],
            },
          ],
          countries: [{ iso2: 'US', name: 'United States' }],
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

  it('loads rows and expands provider details', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: /United States/i })).toBeInTheDocument();
    const initialCompareCalls = global.fetch.mock.calls.filter(([url]) => String(url).startsWith('/api/compare'));
    expect(initialCompareCalls).toHaveLength(1);
    expect(initialCompareCalls[0][0]).toContain('summary=1');

    fireEvent.click(screen.getByRole('button', { name: /United States/i }));
    expect(await screen.findByRole('heading', { name: 'SMSBower' })).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('country=US'));
  });

  it('switches mode and refreshes rows', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /United States/i });
    fireEvent.click(screen.getByRole('button', { name: /无WhatsAPP国家/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('mode=bind'));
    });

    fireEvent.click(screen.getByRole('button', { name: /目前推荐国家\(自测\)/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('mode=recommended'));
    });

    fireEvent.click(screen.getByRole('button', { name: /WhatsApp 接码/i }));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('mode=whatsapp'));
    });
  });
});
