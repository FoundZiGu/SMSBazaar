// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import proxy from '../deploy/cloudflare-proxy/worker.mjs';

const env = { ORIGIN_HOST: 'origin.example.com' };

afterEach(() => vi.unstubAllGlobals());

function setupFetch(status = 200) {
  const fetch = vi.fn(async () => new Response('upstream', {
    status,
    headers: { 'Cache-Control': 'public, max-age=14400' },
  }));
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

describe('VPS edge proxy cache policy', () => {
  it.each(['/', '/index.html', '/api/meta', '/api/compare?country=US&provider=5sim'])('bypasses old edge and browser caches for %s', async (pathname) => {
    const fetch = setupFetch();
    const response = await proxy.fetch(new Request(`https://sms.fur.li${pathname}`), env);
    const [forwarded, options] = fetch.mock.calls[0];
    expect(new URL(forwarded.url).hostname).toBe(env.ORIGIN_HOST);
    expect(new URL(forwarded.url).search).toBe(new URL(`https://sms.fur.li${pathname}`).search);
    expect(options.cache).toBe('no-store');
    expect(options.cf.cacheTtlByStatus['100-599']).toBe(-1);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('X-SMSBazaar-Cache-Policy')).toBe('bypass');
  });

  it.each(['/assets/index-abcdefgh.css', '/fonts/manrope-latin.woff2'])('keeps public static asset caching for %s', async (pathname) => {
    const fetch = setupFetch();
    const response = await proxy.fetch(new Request(`https://sms.fur.li${pathname}`), env);
    expect(fetch.mock.calls[0][1].cf.cacheTtlByStatus['200-299']).toBe(86400);
    expect(response.headers.get('X-SMSBazaar-Cache-Policy')).toBe('static-24h');
  });

  it('preserves administrator refresh method, token, and body', async () => {
    const fetch = setupFetch();
    await proxy.fetch(new Request('https://sms.fur.li/api/refresh', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
      body: '{"refresh":true}',
    }), env);
    const [forwarded, options] = fetch.mock.calls[0];
    expect(forwarded.method).toBe('POST');
    expect(forwarded.headers.get('Authorization')).toBe('Bearer test-token');
    expect(forwarded.headers.get('X-Forwarded-Host')).toBe('sms.fur.li');
    expect(await forwarded.text()).toBe('{"refresh":true}');
    expect(options.cache).toBe('no-store');
    expect(options.redirect).toBe('manual');
  });

  it.each(['Authorization', 'Cookie'])('does not cache static requests with %s', async (header) => {
    const fetch = setupFetch();
    await proxy.fetch(new Request('https://sms.fur.li/assets/index-abcdefgh.js', {
      headers: { [header]: 'test-value' },
    }), env);
    expect(fetch.mock.calls[0][1].cache).toBe('no-store');
  });

  it('does not turn asset errors into long browser cache entries', async () => {
    setupFetch(404);
    const response = await proxy.fetch(new Request('https://sms.fur.li/assets/missing.js'), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('X-SMSBazaar-Cache-Policy')).toBe('bypass');
  });

  it('rejects other hosts and missing origin configuration without proxying', async () => {
    const fetch = setupFetch();
    expect((await proxy.fetch(new Request('https://other.example/'), env)).status).toBe(403);
    expect((await proxy.fetch(new Request('https://sms.fur.li/'), {})).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
