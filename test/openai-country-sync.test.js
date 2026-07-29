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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('OpenAI country synchronization', () => {
  it('normalizes the official API country names and known aliases', () => {
    const iso2List = fs.readFileSync(
      path.resolve('data/openai-supported-api-countries.txt'),
      'utf8',
    )
      .split(/\r?\n/)
      .map((line) => line.trim().toUpperCase())
      .filter((line) => /^[A-Z]{2}$/.test(line));
    const aliases = new Map([
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
    const entries = iso2List.map((iso2) => aliases.get(iso2) || toCountryInfo(iso2).englishName);

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
});
