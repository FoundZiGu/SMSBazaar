import React, { useEffect, useMemo, useState } from 'react';

const SORT_OPTIONS = [
  { value: 'price_asc', label: '价格从低到高' },
  { value: 'price_desc', label: '价格从高到低' },
  { value: 'stock_desc', label: '库存从高到低' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'out_of_stock', label: '无库存' },
  { value: 'stale', label: '缓存数据' },
  { value: 'error', label: '异常' },
];

const THEME_OPTIONS = ['system', 'light', 'dark'];

const THEME_LABELS = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
};

function formatPrice(value, currency, suffix = '') {
  if (!Number.isFinite(Number(value))) return '-';
  return `${currency} ${Number(value).toFixed(4).replace(/\.?0+$/, '')}${suffix ? ` ${suffix}` : ''}`;
}

function formatDualPrice(usdValue, cnyRate) {
  if (usdValue === null || usdValue === undefined || !Number.isFinite(Number(usdValue))) {
    return {
      cnyText: '-',
      usdText: '-',
    };
  }
  const safeUsd = Number(usdValue);
  const safeRate = Number(cnyRate || 0);
  const cnyValue = safeUsd * safeRate;
  return {
    cnyText: formatPrice(cnyValue, 'CNY', '￥'),
    usdText: formatPrice(safeUsd, 'USD', '＄'),
  };
}

function getFlagImageUrl(iso2) {
  const code = String(iso2 || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return '';
  return `https://flagcdn.com/w40/${code}.png`;
}

function getRecommendationPathLabel(pathCode) {
  if (pathCode === 0) return '注册';
  if (pathCode === 1) return '绑定';
  return '-';
}

function FlagIcon({ iso2, alt }) {
  const src = getFlagImageUrl(iso2);
  if (!src) {
    return <span className="flag-icon flag-icon--fallback">🏳️</span>;
  }

  return (
    <img
      className="flag-icon"
      src={src}
      alt={alt}
      loading="lazy"
      width="20"
      height="15"
    />
  );
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

function formatRefreshInterval(ms) {
  const totalMinutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
  return `每${totalMinutes}分钟1次`;
}

function StatusPill({ status }) {
  const labelMap = {
    in_stock: '在线',
    out_of_stock: '无库存',
    stale: '缓存',
    error: '异常',
  };
  return <span className={`status-pill status-pill--${status}`}>{labelMap[status] || status}</span>;
}

function ThemeIcon({ theme }) {
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }

  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.55.1.75-.24.75-.53v-2c-3.05.67-3.7-1.3-3.7-1.3-.5-1.25-1.22-1.58-1.22-1.58-1-.68.08-.67.08-.67 1.1.08 1.68 1.14 1.68 1.14.98 1.68 2.58 1.2 3.2.92.1-.72.38-1.2.7-1.48-2.43-.28-5-1.22-5-5.42 0-1.2.43-2.18 1.13-2.95-.12-.28-.5-1.4.1-2.9 0 0 .93-.3 3.05 1.13A10.6 10.6 0 0 1 12 6.48c.94 0 1.9.13 2.78.38 2.12-1.43 3.05-1.13 3.05-1.13.6 1.5.22 2.62.1 2.9.7.77 1.13 1.75 1.13 2.95 0 4.22-2.58 5.14-5.03 5.4.4.35.75 1.03.75 2.08v3.08c0 .3.2.63.76.52A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

function getStoredThemePreference() {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem('themePreference');
  return THEME_OPTIONS.includes(stored) ? stored : 'system';
}

function TierList({ tiers, cnyRate }) {
  return (
    <div className="tier-list">
      {tiers.map((tier) => (
        <div key={`${tier.providerRef}-${tier.priceOriginal}-${tier.stock}`} className="tier-chip">
          <span>{formatDualPrice(tier.priceUsd, cnyRate).cnyText}</span>
          <span>≈ {formatDualPrice(tier.priceUsd, cnyRate).usdText}</span>
          <span>{tier.stock} 库存</span>
          {tier.providerRef ? <span>#{tier.providerRef}</span> : null}
        </div>
      ))}
    </div>
  );
}

function CountryCombobox({ countries, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const selected = countries.find((country) => country.iso2 === value);
    setQuery(selected?.displayName || '');
  }, [countries, value]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return countries;
    return countries.filter((country) => {
      const haystack = [
        country.displayName,
        country.chineseName,
        country.englishName,
        country.iso2,
      ].join(' ').toLowerCase();
      return haystack.includes(normalized);
    });
  }, [countries, query]);

  return (
    <div
      className="country-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          const selected = countries.find((country) => country.iso2 === value);
          setQuery(selected?.displayName || '');
        }
      }}
    >
      <input
        className="country-combobox__input"
        placeholder="搜索国家 / Search country"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value.trim()) {
            onChange('');
          }
        }}
      />
      {open ? (
        <div className="country-combobox__menu">
          <button
            type="button"
            className={value === '' ? 'country-combobox__option is-active' : 'country-combobox__option'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(false);
            }}
          >
            <span>🌐</span>
            <span>全部国家</span>
          </button>
          {filtered.map((country) => (
            <button
              key={country.iso2}
              type="button"
              className={value === country.iso2 ? 'country-combobox__option is-active' : 'country-combobox__option'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(country.iso2);
                setQuery(country.displayName);
                setOpen(false);
              }}
            >
              <FlagIcon iso2={country.iso2} alt={country.displayName} />
              <span>{country.displayName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [themePreference, setThemePreference] = useState(getStoredThemePreference);
  const [meta, setMeta] = useState(null);
  const [compare, setCompare] = useState({ rows: [], countries: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [tierExpanded, setTierExpanded] = useState({});
  const [filters, setFilters] = useState({
    mode: 'register',
    country: '',
    provider: '',
    status: '',
    sort: 'price_asc',
  });

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

  async function loadMeta() {
    const response = await fetch('/api/meta');
    if (!response.ok) throw new Error('加载元数据失败');
    const payload = await response.json();
    setMeta(payload);
  }

  async function loadCompare(nextFilters = filters) {
    const params = new URLSearchParams(nextFilters);
    const response = await fetch(`/api/compare?${params.toString()}`);
    if (!response.ok) throw new Error('加载对比数据失败');
    const payload = await response.json();
    setCompare(payload);
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError('');
        const [metaResponse, compareResponse] = await Promise.all([
          fetch('/api/meta'),
          fetch(`/api/compare?${new URLSearchParams(filters).toString()}`),
        ]);
        if (!metaResponse.ok || !compareResponse.ok) {
          throw new Error('初始化加载失败');
        }
        const [metaPayload, comparePayload] = await Promise.all([
          metaResponse.json(),
          compareResponse.json(),
        ]);
        if (cancelled) return;
        setMeta(metaPayload);
        setCompare(comparePayload);
      } catch (bootstrapError) {
        if (!cancelled) setError(bootstrapError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!meta) return;
    let cancelled = false;
    async function refreshCompare() {
      try {
        setError('');
        const params = new URLSearchParams(filters);
        const response = await fetch(`/api/compare?${params.toString()}`);
        if (!response.ok) throw new Error('筛选刷新失败');
        const payload = await response.json();
        if (!cancelled) setCompare(payload);
      } catch (filterError) {
        if (!cancelled) setError(filterError.message);
      }
    }
    refreshCompare();
    return () => {
      cancelled = true;
    };
  }, [filters.mode, filters.country, filters.provider, filters.status, filters.sort, meta]);

  const providerOptions = useMemo(() => (meta?.providers || []).map((provider) => ({
    value: provider.providerKey,
    label: provider.displayName,
  })), [meta]);
  const cnyRate = Number(meta?.display?.cnyRateFromUsd || 7.2);

  const summary = useMemo(() => ({
    countryCount: compare.rows?.length || 0,
    providerCount: meta?.providers?.length || 0,
  }), [compare.rows, meta]);

  const themeTitle = `主题：${THEME_LABELS[themePreference]}，点击切换`;

  if (loading) {
    return <div className="page-shell"><div className="loading-card">正在加载价格快照...</div></div>;
  }

  return (
    <div className="page-shell">
      <button
        type="button"
        className="theme-toggle"
        title={themeTitle}
        aria-label={themeTitle}
        onClick={() => {
          setThemePreference((current) => {
            const currentIndex = THEME_OPTIONS.indexOf(current);
            return THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];
          });
        }}
      >
        <ThemeIcon theme={themePreference} />
      </button>

      <div className="hero-bar">
        <div>
          <p className="eyebrow">Realtime snapshot across 7 providers</p>
          <h1>{meta?.service?.displayName} 短信价格对比</h1>
        </div>
        <div className="hero-meta">
          <div className="hero-badge">
            <span>国家</span>
            <strong>{summary.countryCount}</strong>
          </div>
          <div className="hero-badge">
            <span>平台</span>
            <strong>{summary.providerCount}</strong>
          </div>
          <div className="hero-badge">
            <span>更新时间</span>
            <strong>{formatTime(compare.updatedAt || meta?.lastRefresh?.completed_at)}</strong>
          </div>
          <div className="hero-badge">
            <span>刷新时间</span>
            <strong>{formatRefreshInterval(meta?.display?.refreshIntervalMs)}</strong>
          </div>
        </div>
      </div>

      <div className="panel card">
        <div className="project-links" aria-label="GitHub 项目入口">
          <a
            className="project-link"
            href="https://github.com/FoundZiGu/SMSBazaar"
            target="_blank"
            rel="noreferrer"
            title="本项目开源地址"
          >
            <GithubIcon />
            <span>
              <strong>本项目开源地址</strong>
              <small>FoundZiGu/SMSBazaar</small>
            </span>
          </a>
        </div>

        <div className="toolbar">
          <label>
            国家
            <CountryCombobox
              countries={compare.countries || []}
              value={filters.country}
              onChange={(nextCountry) => setFilters((current) => ({ ...current, country: nextCountry }))}
            />
          </label>
          <label>
            平台
            <select value={filters.provider} onChange={(event) => setFilters((current) => ({ ...current, provider: event.target.value }))}>
              <option value="">全部平台</option>
              {providerOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label>
            排序
            <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mode-switch">
          <button
            type="button"
            className={filters.mode === 'register' ? 'mode-switch__button is-active' : 'mode-switch__button'}
            onClick={() => setFilters((current) => ({ ...current, mode: 'register' }))}
          >
            先手机号注册 OAuth
            <small>OPENAI支持的国家地区</small>
          </button>
          <button
            type="button"
            className={filters.mode === 'bind' ? 'mode-switch__button is-active' : 'mode-switch__button'}
            onClick={() => setFilters((current) => ({ ...current, mode: 'bind' }))}
          >
            后手机号绑定 OAuth
            <small>无WhatsAPP国家</small>
          </button>
          <button
            type="button"
            className={filters.mode === 'recommended' ? 'mode-switch__button is-active' : 'mode-switch__button'}
            onClick={() => setFilters((current) => ({ ...current, mode: 'recommended' }))}
          >
            目前推荐国家(自测)
            <small>推荐白名单</small>
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="table-shell">
          <div className="table-head">
            <span>国家</span>
            <span>最低价格</span>
            <span>总库存</span>
            <span>在线平台</span>
            <span>更新时间</span>
            <span>推荐路径</span>
          </div>

          {(compare.rows || []).map((row) => {
            const isOpen = Boolean(expanded[row.countryIso2]);
            return (
              <div key={row.countryIso2} className="country-group">
                <button
                  type="button"
                  className="country-row"
                  onClick={() => setExpanded((current) => ({ ...current, [row.countryIso2]: !isOpen }))}
                >
                  <span className="country-row__country">
                    <strong><FlagIcon iso2={row.countryIso2} alt={row.countryDisplayName || row.countryName} /> {row.countryDisplayName || row.countryName}</strong>
                    <small>{row.countryIso2}</small>
                  </span>
                  <span>
                    {formatDualPrice(row.minPriceUsd, cnyRate).cnyText}
                    {row.minPriceUsd === null || row.minPriceUsd === undefined
                      ? null
                      : <small> ≈ {formatDualPrice(row.minPriceUsd, cnyRate).usdText}</small>}
                  </span>
                  <span>{row.inventoryTotal}</span>
                  <span>{row.providerCount}</span>
                  <span>{formatTime(row.lastFetchedAt)}</span>
                  <span>{getRecommendationPathLabel(row.recommendationPath)}</span>
                </button>

                {isOpen ? (
                  <div className="provider-list">
                    {row.offers.map((offer) => {
                      const tierKey = `${row.countryIso2}:${offer.providerKey}`;
                      const tiersOpen = Boolean(tierExpanded[tierKey]);
                      return (
                        <div key={`${row.countryIso2}-${offer.providerKey}`} className="provider-card">
                        <div className="provider-card__header">
                          <div>
                            <h3>{offer.providerName}</h3>
                            <p>{offer.providerKey}</p>
                          </div>
                          <StatusPill status={offer.status} />
                        </div>
                        <div className="provider-card__stats">
                          <div>
                            <span>最低价</span>
                            <strong>{formatDualPrice(offer.minPriceUsd, cnyRate).cnyText}</strong>
                            <small>≈ {formatDualPrice(offer.minPriceUsd, cnyRate).usdText}</small>
                          </div>
                          <div>
                            <span>库存</span>
                            <strong>{offer.inventoryTotal}</strong>
                          </div>
                          <div>
                            <span>更新时间</span>
                            <strong>{formatTime(offer.lastFetchedAt)}</strong>
                          </div>
                        </div>
                        <button
                          type="button"
                          className={tiersOpen ? 'tier-toggle is-open' : 'tier-toggle'}
                          onClick={() => setTierExpanded((current) => ({ ...current, [tierKey]: !tiersOpen }))}
                        >
                          <span>价格档位</span>
                          <strong>{offer.tiers.length}</strong>
                          <small>{tiersOpen ? '收起' : '展开'}</small>
                        </button>
                        {tiersOpen ? <TierList tiers={offer.tiers} cnyRate={cnyRate} /> : null}
                        {offer.errorMessage ? <div className="provider-card__error">{offer.errorMessage}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          {!compare.rows?.length ? <div className="empty-state">当前筛选条件下没有可展示的数据。</div> : null}
        </div>
      </div>
    </div>
  );
}

export default App;
