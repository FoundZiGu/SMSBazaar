import { parseRecommendationLine } from '../src/lib/recommended-country-config';
import recommendedCountryPathsText from '../data/recommended-country-paths.txt';
import openAiSupportedCountriesText from '../data/openai-supported-api-countries.txt';
import openAiSupportedWhatsAppCountriesText from '../data/openai-supported-whatsapp-countries.txt';

export function loadRecommendedCountryConfig(fallbackIso2List = []) {
  const entries = [];
  const lines = String(recommendedCountryPathsText || '').split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseRecommendationLine(line);
    if (parsed) entries.push(parsed);
  }

  let source = 'bundled';
  if (!entries.length) {
    source = 'fallback';
    for (const iso2 of fallbackIso2List) {
      entries.push({
        iso2: String(iso2 || '').toUpperCase(),
        pathCode: 0,
      });
    }
  }

  const pathByIso2 = new Map(entries.map((entry) => [entry.iso2, entry.pathCode]));
  return {
    source,
    updatedAt: '',
    entries,
    pathByIso2,
    whitelist: entries.map((entry) => entry.iso2),
  };
}

export function loadOpenAiSupportedCountries() {
  const whitelist = String(openAiSupportedCountriesText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim().toUpperCase())
    .filter((line) => /^[A-Z]{2}$/.test(line));

  return {
    updatedAt: '',
    whitelist,
  };
}

export function loadOpenAiSupportedWhatsAppCountries() {
  const whitelist = String(openAiSupportedWhatsAppCountriesText || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim().toUpperCase())
    .filter((line) => /^[A-Z]{2}$/.test(line));

  return {
    updatedAt: '',
    whitelist,
  };
}
