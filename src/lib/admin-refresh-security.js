'use strict';

const crypto = require('node:crypto');
const { isIP } = require('node:net');

function parseTrustedProxies(value) {
  const entries = String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (['loopback', 'linklocal', 'uniquelocal'].includes(entry)) continue;
    const [address, prefix, ...extra] = entry.split('/');
    const family = isIP(address);
    if (!family || extra.length || (prefix !== undefined && (
      !/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128)
    ))) {
      throw new TypeError('TRUST_PROXY must contain explicit proxy IPs/CIDRs or named address ranges');
    }
  }
  return entries;
}

function digestToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

function createAdminRefreshSecurity({
  token,
  maxFailures = 5,
  windowMs = 60000,
  maxClients = 1024,
  now = () => Date.now(),
}) {
  for (const value of [maxFailures, windowMs, maxClients]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError('Authentication failure limits must be positive integers');
    }
  }

  const expectedDigest = digestToken(token);
  const failures = new Map();

  function isAuthorized(providedToken) {
    return Boolean(token) && crypto.timingSafeEqual(digestToken(providedToken), expectedDigest);
  }

  function recordFailure(client) {
    const timestamp = now();
    // Fixed windows keep insertion order aligned with expiry; no cleanup timer is needed.
    for (const [key, entry] of failures) {
      if (entry.expiresAt > timestamp) break;
      failures.delete(key);
    }

    let entry = failures.get(client);
    if (!entry) {
      if (failures.size >= maxClients) {
        const firstExpiry = failures.values().next().value.expiresAt;
        return { limited: true, retryAfterMs: Math.max(1, firstExpiry - timestamp) };
      }
      entry = { count: 0, expiresAt: timestamp + windowMs };
      failures.set(client, entry);
    }

    entry.count = Math.min(entry.count + 1, maxFailures + 1);
    return {
      limited: entry.count > maxFailures,
      retryAfterMs: Math.max(1, entry.expiresAt - timestamp),
    };
  }

  return {
    isAuthorized,
    recordFailure,
    clearFailures(client) {
      failures.delete(client);
    },
    get trackedClientCount() {
      return failures.size;
    },
  };
}

module.exports = { createAdminRefreshSecurity, parseTrustedProxies };
