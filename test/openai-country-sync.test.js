import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toCountryInfo } from '../src/lib/country-normalizer';
import {
  createOpenAiCountrySync,
  parseApiCountryEntries,
  parseWhatsAppCountryEntries,
} from '../src/lib/openai-country-sync';

const temporaryDirectories = [];
const officialApiNameOverrides = new Map([
  ['BN', 'Brunei'],
  ['CV', 'Cabo Verde'],
  ['CG', 'Congo (Brazzaville)'],
  ['CD', 'Congo (DRC)'],
  ['CZ', 'Czechia (Czech Republic)'],
  ['SZ', 'Eswatini (Swaziland)'],
  ['VA', 'Holy See (Vatican City)'],
  ['FM', 'Micronesia'],
  ['MD', 'Moldova'],
  ['PS', 'Palestine'],
  ['ST', 'Sao Tome and Principe'],
  ['TL', 'Timor-Leste (East Timor)'],
  ['UA', 'Ukraine (with certain exceptions)'],
]);

function loadApiIso2List() {
  return fs.readFileSync(path.resolve('data/openai-supported-api-countries.txt'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().toUpperCase())
    .filter((line) => /^[A-Z]{2}$/.test(line));
}

function toOfficialApiEntries(iso2List) {
  return iso2List.map((iso2) => (
    officialApiNameOverrides.get(iso2) || toCountryInfo(iso2).englishName
  ));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('OpenAI country synchronization', () => {
  it('normalizes the official API country names and known aliases', () => {
    const iso2List = loadApiIso2List();
    const entries = toOfficialApiEntries(iso2List);

    expect(parseApiCountryEntries(entries)).toEqual(iso2List);
  });

  it('parses ISO-prefixed WhatsApp entries', () => {
    const entries = [
      'AE: United Arab Emirates (+971)',
      'EG: Egypt (+20)',
      'ID: Indonesia (+62)',
      'IL: Israel (+972)',
      'IN: India (+91)',
      'MY: Malaysia (+60)',
      'NG: Nigeria (+234)',
      'PK: Pakistan (+92)',
      'SA: Saudi Arabia (+966)',
      'TR: Turkey (+90)',
      'UA: Ukraine (+380)',
      'VN: Vietnam (+84)',
    ];

    expect(parseWhatsAppCountryEntries(entries)).toEqual([
      'AE', 'EG', 'ID', 'IL', 'IN', 'MY', 'NG', 'PK', 'SA', 'TR', 'UA', 'VN',
    ]);
  });

  it('keeps the last successful country files when an official page fetch fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smsbazaar-country-sync-'));
    temporaryDirectories.push(directory);
    const apiFile = path.join(directory, 'api.txt');
    const whatsappFile = path.join(directory, 'whatsapp.txt');
    fs.writeFileSync(apiFile, 'US\n', 'utf8');
    fs.writeFileSync(whatsappFile, 'AE\n', 'utf8');

    let launchOptions;
    const controller = createOpenAiCountrySync({
      apiCountriesFilePath: apiFile,
      whatsappCountriesFilePath: whatsappFile,
      stateFilePath: path.join(directory, 'state.json'),
      launchBrowser: async (options) => {
        launchOptions = options;
        throw new Error('official page unavailable');
      },
    });
    const result = await controller.runSync(true);

    expect(result.status).toBe('error');
    expect(launchOptions.env.HOME).toBe(path.join(directory, 'chrome-home'));
    expect(launchOptions.args).toContain('--disable-extensions');
    expect(fs.readFileSync(apiFile, 'utf8')).toBe('US\n');
    expect(fs.readFileSync(whatsappFile, 'utf8')).toBe('AE\n');
  });

  it('downloads and validates repository snapshots in remote mode', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smsbazaar-remote-sync-'));
    temporaryDirectories.push(directory);
    const apiText = fs.readFileSync(path.resolve('data/openai-supported-api-countries.txt'), 'utf8');
    const whatsappText = fs.readFileSync(path.resolve('data/openai-supported-whatsapp-countries.txt'), 'utf8');
    const controller = createOpenAiCountrySync({
      apiCountriesFilePath: path.join(directory, 'api.txt'),
      whatsappCountriesFilePath: path.join(directory, 'whatsapp.txt'),
      stateFilePath: path.join(directory, 'state.json'),
      mode: 'remote',
      remoteApiCountriesUrl: 'https://example.test/api.txt',
      remoteWhatsAppCountriesUrl: 'https://example.test/whatsapp.txt',
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        text: async () => (url.endsWith('/api.txt') ? apiText : whatsappText),
      }),
    });

    const result = await controller.runSync(true);

    expect(result.status).toBe('success');
    expect(controller.getState().mode).toBe('remote');
    expect(controller.getState().apiCountryCount).toBe(188);
    expect(controller.getState().whatsappCountryCount).toBe(12);
  });

  it('validates official reader sources and parses proxy markdown', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smsbazaar-proxy-sync-'));
    temporaryDirectories.push(directory);
    const apiMarkdown = [
      'URL Source: http://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories',
      '',
      ...toOfficialApiEntries(loadApiIso2List()).map((entry) => `*   ${entry}`),
      '',
      '## Related articles',
      '*   This entry must not be parsed',
    ].join('\n');
    const whatsappIso2 = ['AE', 'EG', 'ID', 'IL', 'IN', 'MY', 'NG', 'PK', 'SA', 'TR', 'UA', 'VN'];
    const whatsappMarkdown = [
      'URL Source: http://help.openai.com/en/articles/8983038-which-countries-do-you-support-for-whatsapp-phone-verification',
      '',
      ...whatsappIso2.map((iso2) => `*   **${iso2}**: ${toCountryInfo(iso2).englishName}`),
      '',
      '## Was this article helpful?',
    ].join('\n');
    const controller = createOpenAiCountrySync({
      apiCountriesFilePath: path.join(directory, 'api.txt'),
      whatsappCountriesFilePath: path.join(directory, 'whatsapp.txt'),
      stateFilePath: path.join(directory, 'state.json'),
      mode: 'proxy',
      proxyApiCountriesUrl: 'https://example.test/api',
      proxyWhatsAppCountriesUrl: 'https://example.test/whatsapp',
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        text: async () => (url.endsWith('/api') ? apiMarkdown : whatsappMarkdown),
      }),
    });

    const result = await controller.runSync(true);

    expect(result.status).toBe('success');
    expect(controller.getState().apiCountryCount).toBe(188);
    expect(controller.getState().whatsappCountryCount).toBe(12);
  });
});
