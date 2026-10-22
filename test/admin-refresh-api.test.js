// @vitest-environment node

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { createDatabase } from '../src/lib/db';

describe('administrator refresh API security', () => {
  const databases = [];

  beforeEach(() => {
    vi.stubEnv('ADMIN_REFRESH_TOKEN', 'test-admin-token');
    vi.stubEnv('TRUST_PROXY', '');
  });

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
    vi.unstubAllEnvs();
  });

  function setupApp(result = { accepted: true, status: 'started' }) {
    const db = createDatabase(':memory:');
    databases.push(db);
    const triggerRefresh = vi.fn(() => result);
    const app = createApp({
      db,
      refreshController: { triggerRefresh, getState: () => ({ isRunning: false }) },
    });
    return { app, triggerRefresh };
  }

  it.each([
    ['x-admin-refresh-token', 'test-admin-token'],
    ['Authorization', 'Bearer test-admin-token'],
  ])('accepts the existing %s authentication format', async (header, token) => {
    const { app, triggerRefresh } = setupApp();
    const response = await request(app).post('/api/refresh').set(header, token);
    expect(response.status).toBe(202);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(triggerRefresh).toHaveBeenCalledWith('manual');
  });

  it('returns Retry-After for repeated failures without calling providers', async () => {
    const { app, triggerRefresh } = setupApp();
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post('/api/refresh').set('x-admin-refresh-token', 'wrong')).status).toBe(403);
    }
    const blocked = await request(app).post('/api/refresh').set('x-admin-refresh-token', 'wrong');
    expect(blocked.status).toBe(429);
    expect(blocked.body.reason).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(triggerRefresh).not.toHaveBeenCalled();
  });

  it('does not let anonymous traffic behind the same proxy lock out valid credentials', async () => {
    const { app, triggerRefresh } = setupApp();
    for (let i = 0; i < 8; i += 1) await request(app).post('/api/refresh');
    const response = await request(app).post('/api/refresh').set('x-admin-refresh-token', 'test-admin-token');
    expect(response.status).toBe(202);
    expect(triggerRefresh).toHaveBeenCalledTimes(1);
    expect((await request(app).post('/api/refresh')).status).toBe(403);
  });

  it('does not trust spoofed client-IP headers by default', async () => {
    const { app } = setupApp();
    expect(app.get('trust proxy')).toBe(false);
    for (let i = 0; i < 5; i += 1) {
      expect((await request(app).post('/api/refresh').set('X-Forwarded-For', `192.0.2.${i}`).set('CF-Connecting-IP', `192.0.2.${i}`)).status).toBe(403);
    }
    const response = await request(app).post('/api/refresh').set('X-Forwarded-For', '198.51.100.1');
    expect(response.status).toBe(429);
  });

  it('separates real clients when the connecting proxy is explicitly trusted', async () => {
    vi.stubEnv('TRUST_PROXY', 'loopback');
    const { app } = setupApp();
    for (let i = 0; i < 6; i += 1) {
      await request(app).post('/api/refresh').set('X-Forwarded-For', '192.0.2.1');
    }
    expect((await request(app).post('/api/refresh').set('X-Forwarded-For', '192.0.2.1')).status).toBe(429);
    expect((await request(app).post('/api/refresh').set('X-Forwarded-For', '192.0.2.2')).status).toBe(403);
  });

  it('ignores forwarding headers if the connecting peer is not trusted', async () => {
    vi.stubEnv('TRUST_PROXY', '192.0.2.1/32');
    const { app } = setupApp();
    for (let i = 0; i < 6; i += 1) {
      await request(app).post('/api/refresh').set('X-Forwarded-For', `198.51.100.${i}`);
    }
    expect((await request(app).post('/api/refresh').set('X-Forwarded-For', '198.51.100.20')).status).toBe(429);
  });

  it('resets failed-request limits after the fixed window', async () => {
    let time = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    const { app } = setupApp();
    for (let i = 0; i < 6; i += 1) await request(app).post('/api/refresh');
    time += 60000;
    expect((await request(app).post('/api/refresh')).status).toBe(403);
  });

  it.each(['cooldown', 'already_running'])('preserves the existing %s protection', async (reason) => {
    const { app, triggerRefresh } = setupApp({ accepted: false, reason });
    const response = await request(app).post('/api/refresh').set('x-admin-refresh-token', 'test-admin-token');
    expect(response.status).toBe(429);
    expect(response.body.reason).toBe(reason);
    expect(triggerRefresh).toHaveBeenCalledTimes(1);
  });

  it('keeps an unconfigured refresh endpoint disabled even after repeated requests', async () => {
    vi.stubEnv('ADMIN_REFRESH_TOKEN', '');
    const { app, triggerRefresh } = setupApp();
    for (let i = 0; i < 8; i += 1) {
      expect((await request(app).post('/api/refresh')).status).toBe(503);
    }
    expect(triggerRefresh).not.toHaveBeenCalled();
  });

  it.each(['true', '1', '*', '0.0.0.0/0', '::/0', '192.0.2.1/33', '2001:db8::/129'])('rejects unsafe proxy trust (%s)', (value) => {
    vi.stubEnv('TRUST_PROXY', value);
    expect(() => setupApp()).toThrow();
  });
});
