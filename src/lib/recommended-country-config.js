'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseRecommendationLine(line) {
  const normalized = String(line || '').trim();
  if (!normalized || normalized.startsWith('#')) return null;

  const match = normalized.match(/^([A-Za-z]{2})\s+([01])$/);
  if (!match) return null;

  return {
    iso2: match[1].toUpperCase(),
    pathCode: Number.parseInt(match[2], 10),
  };
}

function loadRecommendedCountryConfig(filePath, fallbackIso2List = []) {
  const resolvedPath = path.resolve(filePath);
  const entries = [];
  let updatedAt = '';
  let source = 'file';

  if (fs.existsSync(resolvedPath)) {
    const stat = fs.statSync(resolvedPath);
    updatedAt = stat.mtime.toISOString();
    const lines = fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const parsed = parseRecommendationLine(line);
      if (parsed) entries.push(parsed);
    }
  } else {
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
    filePath: resolvedPath,
    source,
    updatedAt,
    entries,
    pathByIso2,
    whitelist: entries.map((entry) => entry.iso2),
  };
}

module.exports = {
  loadRecommendedCountryConfig,
  parseRecommendationLine,
};
