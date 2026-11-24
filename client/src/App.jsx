import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SORT_OPTIONS = [
  { value: 'price_asc', label: '价格从低到高' },
  { value: 'price_desc', label: '价格从高到低' },
  { value: 'stock_desc', label: '库存从高到低' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'in_stock', label: '有库存' },
  { value: 'out_of_stock', label: '无库存' },
  { value: 'stale', label: '缓存' },
  { value: 'error', label: '异常' },
];

const THEME_OPTIONS = [
  { value: 'system', label: '自动' },
  { value: 'light', label: '亮色' },
  { value: 'dark', label: '暗色' },
];

const CURRENCY_OPTIONS = [
  { value: 'CNY', label: '¥ CNY' },
  { value: 'USD', label: '$ USD' },
];

const LOW_STOCK_THRESHOLD = 10;

const COUNTRY_SEARCH_ALIASES = {
  GB: 'uk england britain great britain yingguo 英国 英格兰',
  US: 'usa america united states meiguo 美国 美利坚',
  ID: 'indo indonesia yinni 印尼 印度尼西亚',
  PH: 'philippines feilvbin 菲律宾',
  JP: 'jpn japan riben 日本',
  KR: 'korea south korea hanguo 韩国 南韩',
  HK: 'hongkong hong kong xianggang 香港',
  TW: 'taiwan 台湾',
  CA: 'canada jianada 加拿大',
  FR: 'france faguo 法国',
  DE: 'germany deguo 德国',
  NL: 'netherlands holland helan 荷兰',
  BR: 'brazil baxi 巴西',
  UA: 'ukraine wukelan 乌克兰',
  PL: 'poland bolan 波兰',
  TH: 'thailand taiguo 泰国',
  VN: 'vietnam viet nam yuenan 越南',
  IN: 'india yindu 印度',
  SG: 'singapore xinjiapo 新加坡',
  AU: 'australia aodaliya 澳大利亚 澳洲',
  MY: 'malaysia malaixiya 马来西亚 大马',
  TR: 'turkey turkiye tuerqi 土耳其',
  MX: 'mexico moxige 墨西哥',
  CO: 'colombia gelunbiya 哥伦比亚',
  RU: 'russia eluosi 俄罗斯',
  SE: 'sweden ruidian 瑞典',
  IL: 'israel yiselie 以色列',
  TJ: 'tajikistan tajikesitan 塔吉克斯坦',
  PK: 'pakistan bajisitan 巴基斯坦',
  GE: 'georgia gelujiya 格鲁吉亚',
  AZ: 'azerbaijan asaibaijiang 阿塞拜疆',
  NG: 'nigeria niriliya 尼日利亚',
  EG: 'egypt aiji 埃及',
  ES: 'spain xibanya 西班牙',
  IT: 'italy yidali 意大利',
};

function readInitialUrlState() {
  if (typeof window === 'undefined') {
    return {
      filters: { mode: 'register', country: '', provider: '', status: '', sort: 'price_asc', minStock: 0 },
      query: '',
    };
  }
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode');
  const mode = ['register', 'bind', 'recommended'].includes(rawMode) ? rawMode : 'register';
  const rawStatus = params.get('status') || '';
  const status = ['', 'in_stock', 'out_of_stock', 'stale', 'error'].includes(rawStatus) ? rawStatus : '';
  const rawSort = params.get('sort') || 'price_asc';
  const sort = ['price_asc', 'price_desc', 'stock_desc'].includes(rawSort) ? rawSort : 'price_asc';
  const minStock = Number.parseInt(params.get('minStock') || '0', 10) >= LOW_STOCK_THRESHOLD
    ? LOW_STOCK_THRESHOLD
    : 0;

  return {
    filters: {
      mode,
      country: '',
      provider: params.get('provider') || '',
      status,
      sort,
      minStock,
    },
    query: params.get('q') || '',
  };
}

function syncUrlState(filters, query) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  const params = new URLSearchParams();
  if (filters.mode && filters.mode !== 'register') params.set('mode', filters.mode);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.status) params.set('status', filters.status);
  if (filters.sort && filters.sort !== 'price_asc') params.set('sort', filters.sort);
  if (filters.minStock > 0) params.set('minStock', String(filters.minStock));
  if (query.trim()) params.set('q', query.trim());

  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(null, '', nextUrl);
  }
}

function buildCompareUrl(filters, summary = false) {
  const params = new URLSearchParams({
    mode: filters.mode,
    country: filters.country || '',
    provider: filters.provider || '',
    status: filters.status || '',
    sort: filters.sort || 'price_asc',
  });
  if (Number(filters.minStock || 0) > 0) {
    params.set('minStock', String(filters.minStock));
  }
  if (summary) params.set('summary', '1');
  return `/api/compare?${params.toString()}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

function formatCurrencyValue(usdValue, currency, cnyRate) {
  if (usdValue === null || usdValue === undefined || !Number.isFinite(Number(usdValue))) {
    return '-';
  }
  const safeUsd = Number(usdValue);
  const amount = currency === 'CNY' ? safeUsd * Number(cnyRate || 7.2) : safeUsd;
  const symbol = currency === 'CNY' ? '¥' : '$';
  const digits = amount < 0.1 ? 4 : amount < 1 ? 3 : 2;
  let text = amount.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  if (!text.includes('.')) text += '.00';
  else if (text.split('.')[1].length === 1) text += '0';
  return `${symbol}${text}`;
}

function formatDualCurrency(usdValue, cnyRate, primaryCurrency) {
  if (usdValue === null || usdValue === undefined || !Number.isFinite(Number(usdValue))) {
    return { primary: '—', secondary: '' };
  }
  if (primaryCurrency === 'USD') {
    return {
      primary: formatCurrencyValue(usdValue, 'USD', cnyRate),
      secondary: formatCurrencyValue(usdValue, 'CNY', cnyRate),
    };
  }
  return {
    primary: formatCurrencyValue(usdValue, 'CNY', cnyRate),
    secondary: formatCurrencyValue(usdValue, 'USD', cnyRate),
  };
}

function formatRateText(cnyRate) {
  const num = Number(cnyRate);
  if (!Number.isFinite(num) || num <= 0) return '7.20';
  return num.toFixed(2);
}

function getFlagImageUrl(iso2) {
  const code = String(iso2 || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return '';
  return `/assets/flags/${code}.svg`;
}

function formatTime(value) {
  if (!value) return '未刷新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatShortTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatRelativeAge(value, nowMs) {
  if (!value) return '';
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 45) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return '';
}

function formatRefreshInterval(ms) {
  const totalMinutes = Math.max(1, Math.round(Number(ms || 60000) / 60000));
  return `每 ${totalMinutes} 分钟自动更新`;
}

function getStatusLabel(status) {
  const labelMap = {
    in_stock: '在线',
    out_of_stock: '无库存',
    stale: '缓存',
    error: '异常',
  };
  return labelMap[status] || status;
}

function getStoredThemePreference() {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem('themePreference');
  return ['system', 'light', 'dark'].includes(stored) ? stored : 'system';
}

function getStoredCurrency() {
  if (typeof window === 'undefined') return 'CNY';
  const stored = window.localStorage.getItem('primaryCurrency');
  return stored === 'USD' ? 'USD' : 'CNY';
}

function getStoredFavorites() {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem('favoriteCountries') || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map((code) => String(code || '').toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code));
  } catch {
    return [];
  }
}

function getCountryLabels(row) {
  const iso2 = String(row.countryIso2 || '').toUpperCase();
  const zh = String(row.countryNameZh || '').trim();
  const en = String(row.countryNameEn || '').trim();
  const display = String(row.countryDisplayName || row.countryName || iso2).trim();

  if (zh && en && zh !== en) {
    return { primary: zh, secondary: en };
  }
  const parenMatch = display.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return { primary: parenMatch[1].trim(), secondary: parenMatch[2].trim() };
  }
  return { primary: display || iso2, secondary: en && en !== display ? en : '' };
}

function getOfferEffectivePriceInfo(offer, minTierStock = 0) {
  const threshold = Math.max(1, Number(minTierStock || 0));
  const tiers = Array.isArray(offer.tiers) ? offer.tiers : [];
  if (tiers.length > 0) {
    const eligible = tiers
      .filter((tier) => Number(tier.stock || 0) >= threshold && Number.isFinite(Number(tier.priceUsd)))
      .sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd) || Number(b.stock || 0) - Number(a.stock || 0));
    if (eligible.length > 0) {
      return { priceUsd: Number(eligible[0].priceUsd), tierStock: Number(eligible[0].stock || 0), eligible: true };
    }
    if (threshold > 1) {
      const anyInStock = tiers
        .filter((tier) => Number(tier.stock || 0) > 0 && Number.isFinite(Number(tier.priceUsd)))
        .sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd));
      if (anyInStock.length > 0) {
        return { priceUsd: Number(anyInStock[0].priceUsd), tierStock: Number(anyInStock[0].stock || 0), eligible: false };
      }
    }
  }
  const total = Number(offer.inventoryTotal || 0);
  if (Number.isFinite(Number(offer.minPriceUsd))) {
    return { priceUsd: Number(offer.minPriceUsd), tierStock: total, eligible: total >= threshold };
  }
  return { priceUsd: null, tierStock: 0, eligible: false };
}

function FlagIcon({ iso2, alt }) {
  const [failed, setFailed] = useState(false);
  const src = getFlagImageUrl(iso2);

  useEffect(() => {
    setFailed(false);
  }, [iso2]);

  if (!src || failed) {
    return <span className="flag-fallback" aria-hidden="true">{String(iso2 || '--').toUpperCase()}</span>;
  }

  return (
    <img
      className="flag-img"
      src={src}
      alt={alt}
      loading="lazy"
      width="24"
      height="17"
      onError={() => setFailed(true)}
    />
  );
}

function SearchIcon() {
  return (
    <svg className="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg className={spinning ? 'spin-icon' : ''} width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function StarIcon({ filled }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function TierLadder({ tiers, cnyRate, primaryCurrency, minTierStock }) {
  const [onlyInStockTiers, setOnlyInStockTiers] = useState(false);
  const hasEmptyTiers = tiers.some((tier) => Number(tier.stock || 0) === 0);
  const hasInStockTiers = tiers.some((tier) => Number(tier.stock || 0) > 0);
  const visibleTiers = onlyInStockTiers
    ? tiers.filter((tier) => Number(tier.stock || 0) > 0)
    : tiers;

  return (
    <div className="tier-panel">
      <div className="tier-panel__head">
        <span>价格档位明细（共 {tiers.length} 档）</span>
        {hasEmptyTiers && hasInStockTiers ? (
          <label className="inline-check">
            <input
              type="checkbox"
              checked={onlyInStockTiers}
              onChange={(event) => setOnlyInStockTiers(event.target.checked)}
            />
            仅看有货档位
          </label>
        ) : (
          <span>单价 · 实时库存 · 通道编号</span>
        )}
      </div>
      <div className="tier-grid">
        {visibleTiers.map((tier, index) => {
          const dual = formatDualCurrency(tier.priceUsd, cnyRate, primaryCurrency);
          const stockNum = Number(tier.stock || 0);
          const isLowTier = stockNum > 0 && stockNum < LOW_STOCK_THRESHOLD;
          const isFilteredOut = minTierStock > 0 && stockNum > 0 && stockNum < minTierStock;
          return (
            <div
              key={`${tier.providerRef || 'tier'}-${tier.priceOriginal}-${stockNum}-${index}`}
              className={`tier-card${stockNum === 0 || isFilteredOut ? ' is-empty' : ''}`}
            >
              <div className="tier-card__price">
                <strong>{dual.primary}</strong>
                {dual.secondary ? <small>{dual.secondary}</small> : null}
              </div>
              <div className="tier-card__meta">
                <span className={`tier-card__stock${isLowTier ? ' is-low' : ''}`}>
                  {stockNum > 0 ? `${formatNumber(stockNum)} 库存` : '无货'}
                </span>
                {tier.providerRef ? (
                  <span className="tier-card__ref" title={`#${tier.providerRef}`}>#{tier.providerRef}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function App() {
  const initialUrlState = useMemo(readInitialUrlState, []);
  const [themePreference, setThemePreference] = useState(getStoredThemePreference);
  const [primaryCurrency, setPrimaryCurrency] = useState(getStoredCurrency);
  const [favorites, setFavorites] = useState(getStoredFavorites);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [meta, setMeta] = useState(null);
  const [compare, setCompare] = useState({ rows: [], countries: [], updatedAt: '' });
  const [loading, setLoading] = useState(true);
  const [refreshingList, setRefreshingList] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState(initialUrlState.query);
  const [expanded, setExpanded] = useState({});
  const [tierExpanded, setTierExpanded] = useState({});
  const [onlyInStockOffers, setOnlyInStockOffers] = useState({});
  const [detailOffers, setDetailOffers] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [detailErrors, setDetailErrors] = useState({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [filters, setFilters] = useState(initialUrlState.filters);

  const searchInputRef = useRef(null);
  const skippedInitialFilterLoad = useRef(false);
  const detailsGeneration = useRef(0);
  const filtersRef = useRef(filters);
  const expandedRef = useRef(expanded);
  const lastReloadAtRef = useRef(Date.now());
  const inFlightSyncRef = useRef(false);

  filtersRef.current = filters;
  expandedRef.current = expanded;

  useEffect(() => {
    const root = document.documentElement;
    if (themePreference === 'system') {
      root.removeAttribute('data-theme');
      window.localStorage.removeItem('themePreference');
      return;
    }
    root.dataset.theme = themePreference;
    window.localStorage.setItem('themePreference', themePreference);
  }, [themePreference]);

  useEffect(() => {
    window.localStorage.setItem('primaryCurrency', primaryCurrency);
  }, [primaryCurrency]);

  useEffect(() => {
    window.localStorage.setItem('favoriteCountries', JSON.stringify(favorites));
    if (favorites.length === 0) setOnlyFavorites(false);
  }, [favorites]);

  useEffect(() => {
    syncUrlState(filters, searchQuery);
  }, [filters, searchQuery]);

  // Global keyboard shortcuts: "/" focuses search, "Escape" clears & blurs
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const tag = String(event.target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || event.target?.isContentEditable) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Periodic tick to keep relative timestamps fresh
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  // Initial bootstrap load
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError('');
        const [metaResponse, compareResponse] = await Promise.all([
          fetch('/api/meta'),
          fetch(buildCompareUrl(filtersRef.current, true)),
        ]);
        if (!metaResponse.ok || !compareResponse.ok) {
          throw new Error('初始化加载失败，请稍后重试');
        }
        const [metaPayload, comparePayload] = await Promise.all([
          metaResponse.json(),
          compareResponse.json(),
        ]);
        if (cancelled) return;
        lastReloadAtRef.current = Date.now();
        setMeta(metaPayload);
        setCompare(comparePayload);
      } catch (bootstrapError) {
        if (!cancelled) setError(bootstrapError.message || '初始化加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent background refresh that preserves expanded drawers & filters
  const reloadLatestSnapshot = useCallback(async () => {
    if (inFlightSyncRef.current) return;
    inFlightSyncRef.current = true;
    setSyncingNow(true);
    const activeFilters = filtersRef.current;
    const activeExpandedIso2 = Object.keys(expandedRef.current).filter((key) => expandedRef.current[key]);
    const requestGeneration = detailsGeneration.current;

    try {
      const [metaResponse, compareResponse] = await Promise.all([
        fetch('/api/meta'),
        fetch(buildCompareUrl(activeFilters, true)),
      ]);
      if (!metaResponse.ok || !compareResponse.ok) return;
      const [metaPayload, comparePayload] = await Promise.all([
        metaResponse.json(),
        compareResponse.json(),
      ]);
      if (requestGeneration !== detailsGeneration.current) return;
      lastReloadAtRef.current = Date.now();
      setMeta(metaPayload);
      setCompare(comparePayload);
      setNowMs(Date.now());
      setError('');

      if (activeExpandedIso2.length > 0) {
        const refreshedDetails = await Promise.all(
          activeExpandedIso2.map(async (iso2) => {
            try {
              const res = await fetch(buildCompareUrl({ ...activeFilters, country: iso2 }, false));
              if (!res.ok) return null;
              const payload = await res.json();
              const row = (payload.rows || []).find((item) => item.countryIso2 === iso2);
              return [iso2, row?.offers || []];
            } catch {
              return null;
            }
          }),
        );
        if (requestGeneration !== detailsGeneration.current) return;
        const updates = refreshedDetails.filter(Boolean);
        if (updates.length > 0) {
          setDetailOffers((current) => {
            const next = { ...current };
            for (const [iso2, offers] of updates) next[iso2] = offers;
            return next;
          });
        }
      }
    } finally {
      inFlightSyncRef.current = false;
      setSyncingNow(false);
    }
  }, []);

  // Auto-polling timer + visibility resume
  const refreshIntervalMs = Math.max(15000, Number(meta?.display?.refreshIntervalMs || 60000));
  useEffect(() => {
    if (!meta) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      reloadLatestSnapshot();
    }, refreshIntervalMs);

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastReloadAtRef.current >= Math.min(30000, refreshIntervalMs)) {
        reloadLatestSnapshot();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [meta, refreshIntervalMs, reloadLatestSnapshot]);

  // Refetch compare rows whenever server-side filters change
  useEffect(() => {
    if (!meta) return;
    if (!skippedInitialFilterLoad.current) {
      skippedInitialFilterLoad.current = true;
      return;
    }

    let cancelled = false;
    detailsGeneration.current += 1;
    setExpanded({});
    setTierExpanded({});
    setDetailOffers({});
    setDetailLoading({});
    setDetailErrors({});

    async function refreshCompare() {
      try {
        setRefreshingList(true);
        setError('');
        const response = await fetch(buildCompareUrl(filters, true));
        if (!response.ok) throw new Error('筛选刷新失败，请稍后重试');
        const payload = await response.json();
        if (!cancelled) {
          lastReloadAtRef.current = Date.now();
          setCompare(payload);
        }
      } catch (filterError) {
        if (!cancelled) setError(filterError.message || '筛选刷新失败');
      } finally {
        if (!cancelled) setRefreshingList(false);
      }
    }

    refreshCompare();
    return () => {
      cancelled = true;
    };
  }, [filters.mode, filters.provider, filters.status, filters.sort, filters.minStock, Boolean(meta)]);

  async function toggleCountry(row) {
    const countryIso2 = row.countryIso2;
    if (expanded[countryIso2]) {
      setExpanded((current) => ({ ...current, [countryIso2]: false }));
      return;
    }

    setExpanded((current) => ({ ...current, [countryIso2]: true }));
    if (Object.prototype.hasOwnProperty.call(detailOffers, countryIso2)) return;
    if (row.offers?.length) {
      setDetailOffers((current) => ({ ...current, [countryIso2]: row.offers }));
      return;
    }

    const requestGeneration = detailsGeneration.current;
    setDetailLoading((current) => ({ ...current, [countryIso2]: true }));
    setDetailErrors((current) => ({ ...current, [countryIso2]: '' }));

    try {
      const response = await fetch(buildCompareUrl({ ...filters, country: countryIso2 }, false));
      if (!response.ok) throw new Error('加载平台明细失败');
      const payload = await response.json();
      if (requestGeneration !== detailsGeneration.current) return;
      const detailRow = (payload.rows || []).find((item) => item.countryIso2 === countryIso2);
      setDetailOffers((current) => ({ ...current, [countryIso2]: detailRow?.offers || [] }));
    } catch (detailError) {
      if (requestGeneration !== detailsGeneration.current) return;
      setDetailErrors((current) => ({
        ...current,
        [countryIso2]: detailError.message || '加载平台明细失败',
      }));
    } finally {
      if (requestGeneration === detailsGeneration.current) {
        setDetailLoading((current) => ({ ...current, [countryIso2]: false }));
      }
    }
  }

  function toggleFavorite(iso2) {
    const code = String(iso2 || '').toUpperCase();
    setFavorites((current) => (
      current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code]
    ));
  }

  function handleSortColumn(target) {
    setFilters((current) => {
      if (target === 'price') {
        return { ...current, sort: current.sort === 'price_asc' ? 'price_desc' : 'price_asc' };
      }
      if (target === 'stock') {
        return { ...current, sort: current.sort === 'stock_desc' ? 'price_asc' : 'stock_desc' };
      }
      return current;
    });
  }

  const cnyRate = Number(meta?.display?.cnyRateFromUsd || 7.2);
  const providers = meta?.providers || [];
  const providerWebsiteMap = useMemo(() => {
    const map = new Map();
    for (const provider of providers) {
      if (provider.websiteUrl) map.set(provider.providerKey, provider.websiteUrl);
    }
    return map;
  }, [providers]);

  const onlineProviderCount = useMemo(
    () => providers.filter((provider) => provider.status === 'success').length,
    [providers],
  );

  const recommendedSet = useMemo(
    () => new Set((meta?.service?.recommendedWhitelistIso2 || []).map((code) => String(code).toUpperCase())),
    [meta],
  );

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const rows = compare.rows || [];
    const matched = rows.filter((row) => {
      const iso2 = String(row.countryIso2 || '').toUpperCase();
      if (onlyFavorites && !favoriteSet.has(iso2)) return false;
      if (!query) return true;
      const haystack = [
        row.countryDisplayName,
        row.countryName,
        row.countryNameZh,
        row.countryNameEn,
        iso2,
        COUNTRY_SEARCH_ALIASES[iso2] || '',
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });

    if (favoriteSet.size === 0 || onlyFavorites) return matched;
    const pinned = [];
    const rest = [];
    for (const row of matched) {
      if (favoriteSet.has(String(row.countryIso2 || '').toUpperCase())) pinned.push(row);
      else rest.push(row);
    }
    return [...pinned, ...rest];
  }, [compare.rows, searchQuery, onlyFavorites, favoriteSet]);

  const maxStock = useMemo(
    () => Math.max(...filteredRows.map((row) => Number(row.inventoryTotal || 0)), 1),
    [filteredRows],
  );

  const cheapestRow = useMemo(() => {
    let best = null;
    for (const row of filteredRows) {
      if (row.minPriceUsd === null || row.minPriceUsd === undefined) continue;
      if (!best || Number(row.minPriceUsd) < Number(best.minPriceUsd)) {
        best = row;
      }
    }
    return best;
  }, [filteredRows]);

  const globalMinPriceUsd = cheapestRow ? Number(cheapestRow.minPriceUsd) : null;

  const allCountriesBadgeCount = typeof meta?.modeCounts?.register === 'number'
    ? meta.modeCounts.register
    : (meta?.service?.registerSupportedWhitelistIso2?.length
      || (filters.mode === 'register' && !filters.provider && !filters.status ? (compare.rows?.length || 0) : null));
  const noWhatsappBadgeCount = typeof meta?.modeCounts?.bind === 'number'
    ? meta.modeCounts.bind
    : (meta?.service?.bindWhitelistIso2?.length || null);
  const recommendedBadgeCount = typeof meta?.modeCounts?.recommended === 'number'
    ? meta.modeCounts.recommended
    : (meta?.service?.recommendedWhitelistIso2?.length || null);

  const lastUpdatedRaw = compare.updatedAt || meta?.lastRefresh?.completed_at || '';
  const relativeUpdatedText = formatRelativeAge(lastUpdatedRaw, nowMs);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-box">
          <div className="loading-title">SMSBazaar</div>
          <p>正在加载实时价格快照...</p>
        </div>
      </div>
    );
  }

  const cheapestDual = cheapestRow
    ? formatDualCurrency(cheapestRow.minPriceUsd, cnyRate, primaryCurrency)
    : { primary: '—', secondary: '' };
  const cheapestLabels = cheapestRow ? getCountryLabels(cheapestRow) : null;

  return (
    <div className="app-root">
      <header className="topbar">
        <div className="topbar-inner">
          <h1 className="brand-title">SMSBazaar</h1>

          <div className="topbar-actions">
            <div className="sync-group">
              <span className="meta-pill" title={formatRefreshInterval(meta?.display?.refreshIntervalMs)}>
                {relativeUpdatedText ? `${relativeUpdatedText}同步` : formatRefreshInterval(meta?.display?.refreshIntervalMs)} · $1 = ¥{formatRateText(cnyRate)}
              </span>
              <button
                type="button"
                className="icon-action-btn"
                aria-label="立即拉取最新快照"
                title="立即拉取最新快照"
                disabled={syncingNow}
                onClick={reloadLatestSnapshot}
              >
                <RefreshIcon spinning={syncingNow} />
              </button>
            </div>

            <div className="seg-group" role="group" aria-label="主计价货币">
              {CURRENCY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={primaryCurrency === option.value ? 'seg-btn is-active' : 'seg-btn'}
                  onClick={() => setPrimaryCurrency(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="seg-group" role="group" aria-label="主题切换">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={themePreference === option.value ? 'seg-btn is-active' : 'seg-btn'}
                  onClick={() => setThemePreference(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <a
              className="gh-link"
              href="https://github.com/FoundZiGu/SMSBazaar"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </div>
      </header>

      <main className="page-shell">
        <section className="page-intro">
          <p className="page-subtitle">
            {meta?.service?.displayName || 'OPENAI (ChatGPT)'} 短信接码实时比价 · 聚合 {providers.length} 家平台单价、库存与多档价格池
          </p>
        </section>

        <section className="metrics-grid" aria-label="实时行情概览">
          <div className="metric-card">
            <span className="metric-label">全网最低单价</span>
            <strong className="metric-value metric-value--accent">{cheapestDual.primary}</strong>
            <span className="metric-sub">
              {cheapestRow
                ? [
                    cheapestDual.secondary,
                    cheapestLabels?.primary,
                    cheapestRow.cheapestProviderName,
                  ].filter(Boolean).join(' · ')
                : '当前筛选暂无在售报价'}
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">当前覆盖国家 / 地区</span>
            <strong className="metric-value">{filteredRows.length}</strong>
            <span className="metric-sub">
              {onlyFavorites
                ? '已收藏常用国家'
                : filters.mode === 'recommended'
                  ? '自测精选推荐白名单'
                  : filters.mode === 'bind'
                    ? '无 WhatsApp 接码国家清单'
                    : 'OpenAI 官方支持地区清单'}
            </span>
          </div>

          <div className="metric-card">
            <span className="metric-label">上游平台与快照状态</span>
            <strong className="metric-value">
              {onlineProviderCount || providers.length} / {providers.length} 在线
            </strong>
            <span className="metric-sub">
              最新同步 {formatTime(lastUpdatedRaw)}{relativeUpdatedText ? `（${relativeUpdatedText}）` : ''}
            </span>
          </div>
        </section>

        <section className="control-deck" aria-label="筛选与排序控制">
          <div className="deck-row">
            <div className="scope-tabs" role="tablist" aria-label="国家范围切换">
              <button
                type="button"
                role="tab"
                aria-selected={filters.mode === 'register'}
                className={filters.mode === 'register' ? 'scope-btn is-active' : 'scope-btn'}
                onClick={() => setFilters((current) => ({ ...current, mode: 'register' }))}
              >
                <span>全部国家</span>
                {allCountriesBadgeCount !== null ? (
                  <span className="scope-count">{allCountriesBadgeCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filters.mode === 'bind'}
                className={filters.mode === 'bind' ? 'scope-btn is-active' : 'scope-btn'}
                onClick={() => setFilters((current) => ({ ...current, mode: 'bind' }))}
              >
                <span>无 WhatsApp 国家</span>
                {noWhatsappBadgeCount !== null ? (
                  <span className="scope-count">{noWhatsappBadgeCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filters.mode === 'recommended'}
                className={filters.mode === 'recommended' ? 'scope-btn is-active' : 'scope-btn'}
                onClick={() => setFilters((current) => ({ ...current, mode: 'recommended' }))}
              >
                <span>推荐国家 (自测)</span>
                {recommendedBadgeCount !== null ? (
                  <span className="scope-count">{recommendedBadgeCount}</span>
                ) : null}
              </button>
            </div>

            <div className="search-wrap">
              <SearchIcon />
              <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                aria-label="搜索国家"
                placeholder="搜索国家、拼音或简称（如 英国 / uk / usa）..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setSearchQuery('');
                    event.currentTarget.blur();
                  }
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="search-clear"
                  aria-label="清空搜索"
                  onClick={() => setSearchQuery('')}
                >
                  ×
                </button>
              ) : (
                <kbd className="search-kbd" aria-hidden="true">/</kbd>
              )}
            </div>
          </div>

          <div className="deck-row deck-row--secondary">
            <div className="status-seg" role="group" aria-label="库存状态筛选">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value || 'all'}
                  type="button"
                  className={filters.status === option.value ? 'status-btn is-active' : 'status-btn'}
                  onClick={() => setFilters((current) => ({ ...current, status: option.value }))}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              aria-pressed={filters.minStock >= LOW_STOCK_THRESHOLD}
              className={filters.minStock >= LOW_STOCK_THRESHOLD ? 'toggle-pill is-active' : 'toggle-pill'}
              title="忽略库存少于 10 个的低价诱饵档位"
              onClick={() => setFilters((current) => ({
                ...current,
                minStock: current.minStock >= LOW_STOCK_THRESHOLD ? 0 : LOW_STOCK_THRESHOLD,
              }))}
            >
              过滤 &lt;{LOW_STOCK_THRESHOLD} 库存档
            </button>

            {favorites.length > 0 ? (
              <button
                type="button"
                aria-pressed={onlyFavorites}
                className={onlyFavorites ? 'toggle-pill is-active' : 'toggle-pill'}
                onClick={() => setOnlyFavorites((current) => !current)}
              >
                ★ 仅看收藏 ({favorites.length})
              </button>
            ) : null}

            <select
              className="sort-select"
              aria-label="排序方式"
              value={filters.sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {providers.length > 0 ? (
            <div className="provider-strip" aria-label="按平台筛选">
              <span className="provider-strip__label">平台</span>
              <button
                type="button"
                className={filters.provider === '' ? 'prov-chip is-active' : 'prov-chip'}
                onClick={() => setFilters((current) => ({ ...current, provider: '' }))}
              >
                全部 ({providers.length})
              </button>
              {providers.map((provider) => {
                const isActive = filters.provider === provider.providerKey;
                const dotStatus = provider.status === 'success'
                  ? 'ok'
                  : provider.status === 'error'
                    ? 'err'
                    : 'idle';
                return (
                  <button
                    key={provider.providerKey}
                    type="button"
                    className={isActive ? 'prov-chip is-active' : 'prov-chip'}
                    onClick={() => setFilters((current) => ({
                      ...current,
                      provider: current.provider === provider.providerKey ? '' : provider.providerKey,
                    }))}
                  >
                    <span className={`prov-dot prov-dot--${dotStatus}`} aria-hidden="true" />
                    <span>{provider.displayName}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>

        {error ? <div className="error-banner" role="alert">{error}</div> : null}

        <section className={refreshingList ? 'table-card is-loading' : 'table-card'} aria-label="国家价格对比表">
          <div className="table-head">
            <span className="table-head__country">国家 / 地区</span>
            <button
              type="button"
              className={`th-sort-btn align-right${filters.sort.startsWith('price_') ? ' is-active' : ''}`}
              onClick={() => handleSortColumn('price')}
            >
              最低单价 {filters.sort === 'price_asc' ? '↑' : filters.sort === 'price_desc' ? '↓' : ''}
            </button>
            <button
              type="button"
              className={`th-sort-btn align-right${filters.sort === 'stock_desc' ? ' is-active' : ''}`}
              onClick={() => handleSortColumn('stock')}
            >
              全网总库存 {filters.sort === 'stock_desc' ? '↓' : ''}
            </button>
            <span className="align-center">有货平台</span>
            <span className="align-right">更新时间</span>
          </div>

          {filteredRows.map((row) => {
            const iso2 = String(row.countryIso2 || '').toUpperCase();
            const isOpen = Boolean(expanded[iso2]);
            const isFav = favoriteSet.has(iso2);
            const offers = detailOffers[iso2] || row.offers || [];
            const labels = getCountryLabels(row);
            const dual = formatDualCurrency(row.minPriceUsd, cnyRate, primaryCurrency);
            const stockVal = Number(row.inventoryTotal || 0);
            const stockPct = stockVal > 0
              ? Math.max(5, Math.min(100, Math.round((Math.log10(stockVal + 10) / Math.log10(maxStock + 10)) * 100)))
              : 0;
            const totalProviders = Number(row.providerCount || 0);
            const inStockProviders = typeof row.inStockProviderCount === 'number'
              ? row.inStockProviderCount
              : (stockVal > 0 ? totalProviders : 0);
            const isRecommended = recommendedSet.has(iso2);
            const isTiedBestPrice = globalMinPriceUsd !== null
              && row.minPriceUsd !== null
              && row.minPriceUsd !== undefined
              && Math.abs(Number(row.minPriceUsd) - globalMinPriceUsd) < 1e-9;
            const isLowBaitStock = typeof row.cheapestTierStock === 'number'
              && row.cheapestTierStock > 0
              && row.cheapestTierStock < LOW_STOCK_THRESHOLD;

            const onlyInStock = Boolean(onlyInStockOffers[iso2]);
            const sortedOffers = [...offers].sort((left, right) => {
              const leftInfo = getOfferEffectivePriceInfo(left, filters.minStock);
              const rightInfo = getOfferEffectivePriceInfo(right, filters.minStock);
              const leftIn = left.status === 'in_stock' && leftInfo.eligible ? 0 : 1;
              const rightIn = right.status === 'in_stock' && rightInfo.eligible ? 0 : 1;
              if (leftIn !== rightIn) return leftIn - rightIn;
              const leftPrice = leftInfo.priceUsd ?? Number.POSITIVE_INFINITY;
              const rightPrice = rightInfo.priceUsd ?? Number.POSITIVE_INFINITY;
              return leftPrice - rightPrice || Number(right.inventoryTotal || 0) - Number(left.inventoryTotal || 0);
            });
            const visibleOffers = onlyInStock
              ? sortedOffers.filter((offer) => Number(offer.inventoryTotal || 0) > 0)
              : sortedOffers;
            const inStockOfferList = sortedOffers.filter((offer) => {
              const info = getOfferEffectivePriceInfo(offer, filters.minStock);
              return offer.status === 'in_stock' && info.eligible;
            });
            const basePriceUsd = inStockOfferList.length
              ? getOfferEffectivePriceInfo(inStockOfferList[0], filters.minStock).priceUsd
              : getOfferEffectivePriceInfo(sortedOffers[0] || {}, filters.minStock).priceUsd;
            const maxInStockPriceUsd = Math.max(
              ...inStockOfferList.map((offer) => getOfferEffectivePriceInfo(offer, filters.minStock).priceUsd || 0),
              (basePriceUsd || 0.01) * 1.5,
            );

            return (
              <div key={iso2} className="country-group">
                <div className={isOpen ? 'country-row is-open' : 'country-row'}>
                  <button
                    type="button"
                    className={isFav ? 'fav-btn is-active' : 'fav-btn'}
                    aria-pressed={isFav}
                    aria-label={isFav ? `取消收藏 ${labels.primary}` : `收藏 ${labels.primary}`}
                    title={isFav ? '取消置顶收藏' : '收藏并置顶'}
                    onClick={() => toggleFavorite(iso2)}
                  >
                    <StarIcon filled={isFav} />
                  </button>

                  <button
                    type="button"
                    className="country-row__trigger"
                    aria-expanded={isOpen}
                    onClick={() => toggleCountry(row)}
                  >
                    <div className="country-id">
                      <span className="flag-box">
                        <FlagIcon iso2={iso2} alt={row.countryDisplayName || row.countryName} />
                      </span>
                      <div className="country-names">
                        <div className="country-name-line">
                          <strong className="country-primary">{labels.primary}</strong>
                          <span className="iso-badge">{iso2}</span>
                          {isRecommended && filters.mode !== 'recommended' ? (
                            <span className="rec-badge">推荐</span>
                          ) : null}
                        </div>
                        {labels.secondary ? <span className="country-secondary">{labels.secondary}</span> : null}
                      </div>
                    </div>

                    <div className="price-col">
                      <strong className={isTiedBestPrice ? 'price-primary is-best' : 'price-primary'}>
                        {dual.primary}
                      </strong>
                      <div className="price-sub-line">
                        {dual.secondary ? <small className="price-secondary">{dual.secondary}</small> : null}
                        {isLowBaitStock ? (
                          <span className="low-stock-tag" title={`最低价档位仅剩 ${row.cheapestTierStock} 个库存`}>
                            仅剩 {row.cheapestTierStock}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="stock-col">
                      <span className={stockVal === 0 ? 'stock-num is-zero' : 'stock-num'}>
                        {formatNumber(stockVal)}
                      </span>
                      <div className="stock-bar" aria-hidden="true">
                        <div className="stock-fill" style={{ width: `${stockPct}%` }} />
                      </div>
                    </div>

                    <div className="coverage-col">
                      <span className="coverage-num">
                        {inStockProviders}<span>/{totalProviders}</span>
                      </span>
                      <div className="coverage-pips" aria-hidden="true">
                        {Array.from({ length: Math.min(totalProviders, 8) }, (_, idx) => (
                          <i key={idx} className={idx < inStockProviders ? 'is-on' : ''} />
                        ))}
                      </div>
                    </div>

                    <div className="end-col">
                      <span className="time-text">{formatShortTime(row.lastFetchedAt)}</span>
                      <span className="chevron-box"><ChevronIcon /></span>
                    </div>
                  </button>
                </div>

                {isOpen ? (
                  <div className="drawer">
                    {detailLoading[iso2] ? (
                      <div className="drawer-message">正在加载平台明细...</div>
                    ) : null}

                    {detailErrors[iso2] ? (
                      <div className="drawer-message drawer-message--error">{detailErrors[iso2]}</div>
                    ) : null}

                    {!detailLoading[iso2] && !detailErrors[iso2] && sortedOffers.length === 0 ? (
                      <div className="drawer-message">该国家暂无平台明细。</div>
                    ) : null}

                    {!detailLoading[iso2] && !detailErrors[iso2] && sortedOffers.length > 0 ? (
                      <>
                        <div className="drawer-bar">
                          <div className="drawer-summary">
                            <strong>{inStockOfferList.length}</strong> / {sortedOffers.length} 家平台有货
                            {inStockOfferList[0] ? (
                              <>
                                {' · '}最优报价 <strong>{inStockOfferList[0].providerName}</strong>{' '}
                                ({formatDualCurrency(
                                  getOfferEffectivePriceInfo(inStockOfferList[0], filters.minStock).priceUsd,
                                  cnyRate,
                                  primaryCurrency,
                                ).primary})
                              </>
                            ) : null}
                          </div>
                          <label className="inline-check">
                            <input
                              type="checkbox"
                              checked={onlyInStock}
                              onChange={(event) => setOnlyInStockOffers((current) => ({
                                ...current,
                                [iso2]: event.target.checked,
                              }))}
                            />
                            仅看有货平台
                          </label>
                        </div>

                        <div className="offer-head">
                          <span>平台</span>
                          <span>状态</span>
                          <span className="align-right">单价</span>
                          <span className="offer-head__spread">相对价差</span>
                          <span className="align-right">可用库存</span>
                          <span className="align-right">价格档位</span>
                        </div>

                        <div className="offer-list">
                          {visibleOffers.map((offer) => {
                            const tierKey = `${iso2}:${offer.providerKey}`;
                            const tiersOpen = Boolean(tierExpanded[tierKey]);
                            const offerStock = Number(offer.inventoryTotal || 0);
                            const priceInfo = getOfferEffectivePriceInfo(offer, filters.minStock);
                            const isBestOffer = offer.status === 'in_stock'
                              && priceInfo.eligible
                              && basePriceUsd !== null
                              && priceInfo.priceUsd !== null
                              && Math.abs(priceInfo.priceUsd - basePriceUsd) < 1e-9;
                            const isOutOfStock = offerStock === 0 || !priceInfo.eligible;
                            const offerDual = formatDualCurrency(priceInfo.priceUsd, cnyRate, primaryCurrency);
                            const ratio = basePriceUsd && priceInfo.priceUsd ? priceInfo.priceUsd / basePriceUsd : 1;
                            const logRatio = Math.log10(Math.max(1, ratio) + 0.35);
                            const logMax = Math.log10(Math.max(1.5, maxInStockPriceUsd / (basePriceUsd || 0.01)) + 0.35);
                            const barPct = isOutOfStock
                              ? 100
                              : Math.max(14, Math.min(100, Math.round((logRatio / logMax) * 100)));
                            const tiers = offer.tiers || [];
                            const providerUrl = providerWebsiteMap.get(offer.providerKey) || '';
                            const offerTime = formatShortTime(offer.lastFetchedAt);
                            const offerAge = formatRelativeAge(offer.lastFetchedAt, nowMs);

                            return (
                              <div
                                key={`${iso2}-${offer.providerKey}`}
                                className={`offer-card${isBestOffer ? ' is-best' : ''}${isOutOfStock ? ' is-oos' : ''}`}
                              >
                                <div className="offer-row">
                                  <div className="offer-name-col">
                                    <div className="offer-name">
                                      <h3>
                                        {providerUrl ? (
                                          <a
                                            className="provider-ext-link"
                                            href={providerUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            <span>{offer.providerName}</span>
                                            <span className="ext-arrow" aria-hidden="true">↗</span>
                                          </a>
                                        ) : offer.providerName}
                                      </h3>
                                      {isBestOffer ? <span className="best-tag">最低</span> : null}
                                    </div>
                                    {offer.lastFetchedAt ? (
                                      <span className="offer-updated" title={`更新时间 ${formatTime(offer.lastFetchedAt)}`}>
                                        更新 {offerTime}{offerAge ? ` · ${offerAge}` : ''}
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="offer-status-col">
                                    <span className={`status-tag status-tag--${offer.status}`}>
                                      {getStatusLabel(offer.status)}
                                    </span>
                                  </div>

                                  <div className="offer-price">
                                    <strong>{offerDual.primary}</strong>
                                    <div className="price-sub-line">
                                      {offerDual.secondary ? <small>{offerDual.secondary}</small> : null}
                                      {priceInfo.tierStock > 0 && priceInfo.tierStock < LOW_STOCK_THRESHOLD ? (
                                        <span className="low-stock-tag">仅剩 {priceInfo.tierStock}</span>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="offer-spread">
                                    <div className="spread-track" aria-hidden="true">
                                      <div className="spread-fill" style={{ width: `${barPct}%` }} />
                                    </div>
                                    <span className="spread-label">
                                      {isOutOfStock
                                        ? (offerStock === 0 ? '暂无库存' : `无 ≥${filters.minStock} 档`)
                                        : ratio <= 1.01
                                          ? '1.0× 最低'
                                          : `${ratio.toFixed(1)}×`}
                                    </span>
                                  </div>

                                  <div className={offerStock === 0 ? 'offer-stock is-zero' : 'offer-stock'}>
                                    {formatNumber(offerStock)}
                                  </div>

                                  <div className="offer-mobile-meta">
                                    <span className={`status-tag status-tag--${offer.status}`}>
                                      {getStatusLabel(offer.status)}
                                    </span>
                                    <span>{formatNumber(offerStock)} 库存</span>
                                  </div>

                                  <div className="offer-tier-col">
                                    <button
                                      type="button"
                                      className={tiersOpen ? 'tier-btn is-open' : 'tier-btn'}
                                      onClick={() => setTierExpanded((current) => ({
                                        ...current,
                                        [tierKey]: !tiersOpen,
                                      }))}
                                    >
                                      {tiers.length} 档 {tiersOpen ? '▴' : '▾'}
                                    </button>
                                  </div>
                                </div>

                                {offer.errorMessage ? (
                                  <div className="offer-error">{offer.errorMessage}</div>
                                ) : null}

                                {tiersOpen && tiers.length > 0 ? (
                                  <TierLadder
                                    tiers={tiers}
                                    cnyRate={cnyRate}
                                    primaryCurrency={primaryCurrency}
                                    minTierStock={filters.minStock}
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {filteredRows.length === 0 ? (
            <div className="empty-state">当前筛选条件下没有可展示的数据。</div>
          ) : null}
        </section>

        <footer className="page-footer">
          <span>按 / 快速搜索 · 点击星标置顶常用国家 · 点击表头切换排序</span>
          <div className="footer-links">
            <a href="https://github.com/FoundZiGu/SMSBazaar" target="_blank" rel="noreferrer">
              FoundZiGu/SMSBazaar
            </a>
            <a href="https://linux.do/" target="_blank" rel="noreferrer">
              友情链接 · LINUX DO
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
