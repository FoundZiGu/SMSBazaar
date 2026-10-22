// @vitest-environment node

import crypto from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAdminRefreshSecurity, parseTrustedProxies } from '../src/lib/admin-refresh-security';

describe('administrator refresh security', () => {
  it('compares fixed-length digests for matching and differently sized tokens', () => {
    const compare = vi.spyOn(crypto, 'timingSafeEqual');
    const security = createAdminRefreshSecurity({ token: 'correct-secret' });
    expect(security.isAuthorized('correct-secret')).toBe(true);
    expect(security.isAuthorized('short')).toBe(false);
    expect(security.isAuthorized('x'.repeat(2048))).toBe(false);
    expect(security.isAuthorized('')).toBe(false);
    expect(security.isAuthorized('correct-secrex')).toBe(false);
    expect(compare).toHaveBeenCalledTimes(5);
    for (const [provided, expected] of compare.mock.calls) {
      expect(provided.length).toBe(32);
      expect(expected.length).toBe(32);
    }
  });

  it('never authorizes an unconfigured token', () => {
    const security = createAdminRefreshSecurity({ token: '' });
    expect(security.isAuthorized('')).toBe(false);
    expect(security.isAuthorized('any')).toBe(false);
  });

  it('accepts explicit IPv4/IPv6 proxy addresses and named ranges', () => {
    expect(parseTrustedProxies('')).toEqual([]);
    expect(parseTrustedProxies(' loopback, 192.0.2.1/32, 2001:db8::/48, ::1 ')).toEqual([
      'loopback', '192.0.2.1/32', '2001:db8::/48', '::1',
    ]);
  });

  it('limits failures per client and resets exactly at window expiry', () => {
    let time = 1000;
    const security = createAdminRefreshSecurity({ token: 'secret', maxFailures: 2, now: () => time });
    expect(security.recordFailure('one').limited).toBe(false);
    expect(security.recordFailure('one').limited).toBe(false);
    expect(security.recordFailure('one')).toEqual({ limited: true, retryAfterMs: 60000 });
    expect(security.recordFailure('two').limited).toBe(false);
    time += 59999;
    expect(security.recordFailure('one')).toEqual({ limited: true, retryAfterMs: 1 });
    time += 1;
    expect(security.recordFailure('one').limited).toBe(false);
    expect(security.trackedClientCount).toBe(1);
  });

  it('does not extend a blocked window with repeated requests', () => {
    let time = 0;
    const security = createAdminRefreshSecurity({ token: 'secret', maxFailures: 1, now: () => time });
    security.recordFailure('one');
    time = 30000;
    expect(security.recordFailure('one').retryAfterMs).toBe(30000);
    time = 60000;
    expect(security.recordFailure('one').limited).toBe(false);
  });

  it('bounds client records without evicting active limits and removes expired records', () => {
    let time = 0;
    const security = createAdminRefreshSecurity({ token: 'secret', maxClients: 2, maxFailures: 1, now: () => time });
    security.recordFailure('one');
    time = 1000;
    security.recordFailure('two');
    for (let i = 0; i < 100; i += 1) {
      expect(security.recordFailure(`other-${i}`).limited).toBe(true);
    }
    expect(security.trackedClientCount).toBe(2);
    expect(security.recordFailure('one').limited).toBe(true);
    time = 60000;
    expect(security.recordFailure('three').limited).toBe(false);
    expect(security.trackedClientCount).toBe(2);
    time = 121000;
    expect(security.recordFailure('four').limited).toBe(false);
    expect(security.trackedClientCount).toBe(1);
  });

  it('can clear one client without clearing other clients', () => {
    const security = createAdminRefreshSecurity({ token: 'secret', maxFailures: 1 });
    security.recordFailure('one');
    security.recordFailure('two');
    security.clearFailures('one');
    expect(security.recordFailure('one').limited).toBe(false);
    expect(security.recordFailure('two').limited).toBe(true);
  });

  it.each([0, -1, Infinity, 1.5])('rejects invalid limits (%s)', (limit) => {
    expect(() => createAdminRefreshSecurity({ token: 'secret', maxClients: limit })).toThrow(RangeError);
  });
});
