import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Chart, Doughnut, Line, Scatter } from 'react-chartjs-2';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { PriceSettingsCard, useUsageData } from '@/components/usage';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import { useUsageStatsStore } from '@/stores/useUsageStatsStore';
import { downloadBlob } from '@/utils/download';
import { loadSyncSettings, syncPrices } from '@/utils/priceSync';
import {
  calculateCost,
  formatCompactNumber,
  formatDurationMs,
  type UsageDetail,
  type UsageTimeRange,
} from '@/utils/usage';
import {
  buildMonitorDashboardData,
  buildMonitorRequestsCsv,
  filterDetailsByRange,
  filterMonitorRequests,
  getCacheReadTokens,
  getRequestTotalTokens,
  type MonitorDimension,
  type MonitorGranularity,
  type MonitorResultFilter,
  type MonitorShareMetric,
} from '@/utils/monitorDashboard';
import styles from './TrackerMonitoringPage.module.scss';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineController,
  LineElement,
  BarController,
  BarElement,
  ArcElement,
  Tooltip,
  Legend,
  Filler
);

type RangePreset = UsageTimeRange | '5h' | 'custom';
interface DateRangeState {
  preset: RangePreset;
  start: string;
  end: string;
}

type RequestSortKey =
  | 'timestamp'
  | 'model'
  | 'source'
  | 'provider'
  | 'result'
  | 'input'
  | 'output'
  | 'reasoning'
  | 'cacheRead'
  | 'total'
  | 'latency'
  | 'ttft'
  | 'cost';
type SortDirection = 'asc' | 'desc';
type RequestColumn =
  | 'timestamp'
  | 'model'
  | 'source'
  | 'provider'
  | 'result'
  | 'input'
  | 'output'
  | 'reasoning'
  | 'cacheRead'
  | 'total'
  | 'latency'
  | 'ttft'
  | 'cost';

const RANGE_STORAGE_KEY = 'cli-proxy-tracker-monitor-range-v2';
const GRANULARITY_STORAGE_KEY = 'cli-proxy-tracker-monitor-granularity-v1';
const REQUEST_COLUMNS_STORAGE_KEY = 'cli-proxy-tracker-monitor-columns-v1';
const DAY_MS = 86_400_000;
const DEFAULT_COLUMNS: RequestColumn[] = [
  'timestamp',
  'model',
  'source',
  'result',
  'input',
  'output',
  'cacheRead',
  'total',
  'latency',
  'cost',
];
const REQUEST_COLUMN_WIDTHS: Record<RequestColumn, number> = {
  timestamp: 176,
  model: 190,
  source: 130,
  provider: 130,
  result: 100,
  input: 100,
  output: 100,
  reasoning: 105,
  cacheRead: 115,
  total: 105,
  latency: 105,
  ttft: 100,
  cost: 105,
};
const ALL_COLUMNS: RequestColumn[] = [
  'timestamp',
  'model',
  'source',
  'provider',
  'result',
  'input',
  'output',
  'reasoning',
  'cacheRead',
  'total',
  'latency',
  'ttft',
  'cost',
];
const PRESET_MS: Record<'5h' | Exclude<UsageTimeRange, 'all'>, number> = {
  '5h': 5 * 60 * 60 * 1000,
  '7h': 7 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};
const MODEL_COLORS = [
  '#716dff',
  '#3dbb91',
  '#e59b24',
  '#d45b9d',
  '#4da3ff',
  '#9b7edb',
  '#d46d5d',
  '#6bbaa7',
];

const toDateInput = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const defaultRange = (): DateRangeState => {
  const today = toDateInput(new Date());
  return { preset: 'custom', start: today, end: today };
};

const loadRange = (): DateRangeState => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(RANGE_STORAGE_KEY) || 'null'
    ) as DateRangeState | null;
    if (parsed?.preset && parsed.start && parsed.end) return parsed;
  } catch {
    // Ignore invalid persisted state.
  }
  return defaultRange();
};

const rangeBounds = (range: DateRangeState): { startMs: number; endMs: number } => {
  const now = Date.now();
  if (range.preset === 'all') return { startMs: 0, endMs: now };
  if (range.preset !== 'custom') {
    return { startMs: now - PRESET_MS[range.preset], endMs: now };
  }
  const startDate = new Date(`${range.start}T00:00:00`);
  const endDate = new Date(`${range.end}T00:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  return {
    startMs: Number.isFinite(startMs) ? startMs : now - 7 * DAY_MS,
    endMs: Number.isFinite(endMs) ? endMs : now,
  };
};

const loadColumns = (): RequestColumn[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(REQUEST_COLUMNS_STORAGE_KEY) || 'null');
    if (Array.isArray(parsed)) {
      const columns = parsed.filter((value): value is RequestColumn => ALL_COLUMNS.includes(value));
      if (columns.length) return columns;
    }
  } catch {
    // Ignore invalid persisted state.
  }
  return DEFAULT_COLUMNS;
};

const formatDateLabel = (timestamp: number, granularity: MonitorGranularity): string => {
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (granularity === 'minute') {
    return `${month}/${day} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  if (granularity === 'hour') {
    return `${month}/${day} ${String(date.getHours()).padStart(2, '0')}:00`;
  }
  if (granularity === 'month') return `${month}/${date.getFullYear()}`;
  return `${month}/${day}`;
};

type TokenDisplayMode = 'full' | 'k' | 'm';

const formatTokenTotal = (value: number, mode: TokenDisplayMode, locale: string): string => {
  const divisor = mode === 'k' ? 1_000 : mode === 'm' ? 1_000_000 : 1;
  return `${(value / divisor).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: mode === 'full' ? 0 : 2,
  })}${mode === 'full' ? '' : mode}`;
};

const formatUsd = (value: number): string =>
  value >= 1 ? `$${value.toFixed(2)}` : value > 0 ? `$${value.toFixed(4)}` : '$0.00';

interface MonitorTooltipRow {
  label: string;
  value: string;
  color?: string;
}

interface MonitorTooltipContext {
  chart: { canvas: HTMLCanvasElement };
  tooltip: {
    opacity: number;
    caretX: number;
    caretY: number;
    dataPoints?: Array<{ dataIndex: number; datasetIndex: number }>;
  };
}

const renderMonitorTooltip = (
  context: MonitorTooltipContext,
  title: string,
  rows: MonitorTooltipRow[]
): void => {
  const parent = context.chart.canvas.parentElement;
  if (!parent) return;
  let tooltip = parent.querySelector<HTMLElement>('[data-monitor-tooltip]');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.dataset.monitorTooltip = 'true';
    tooltip.className = styles.chartTooltip;
    parent.appendChild(tooltip);
  }
  if (context.tooltip.opacity === 0) {
    tooltip.style.opacity = '0';
    return;
  }
  tooltip.replaceChildren();
  const heading = document.createElement('div');
  heading.className = styles.tooltipTitle;
  heading.textContent = title;
  tooltip.appendChild(heading);
  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = styles.tooltipRow;
    const label = document.createElement('span');
    if (row.color) {
      const dot = document.createElement('i');
      dot.style.background = row.color;
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(row.label));
    const value = document.createElement('strong');
    value.textContent = row.value;
    item.append(label, value);
    tooltip.appendChild(item);
  });
  tooltip.style.opacity = '1';
  const left = Math.min(parent.clientWidth - tooltip.offsetWidth - 8, context.tooltip.caretX + 14);
  const top = Math.min(parent.clientHeight - tooltip.offsetHeight - 8, context.tooltip.caretY + 14);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
};

const firstDayOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date: Date, amount: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + amount, 1);

const calendarDays = (month: Date): Array<Date | null> => {
  const first = firstDayOfMonth(month);
  const leading = first.getDay();
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return [
    ...Array.from<null>({ length: leading }).fill(null),
    ...Array.from(
      { length: count },
      (_, index) => new Date(first.getFullYear(), first.getMonth(), index + 1)
    ),
  ];
};

const dateInputToLocalDate = (value: string): Date => new Date(`${value}T00:00:00`);

const requestSortValue = (
  detail: UsageDetail,
  key: RequestSortKey,
  modelPrices: Parameters<typeof calculateCost>[1]
): string | number => {
  if (key === 'timestamp') return detail.__timestampMs ?? Date.parse(detail.timestamp);
  if (key === 'model') return detail.__modelName || 'unknown';
  if (key === 'source') return detail.source;
  if (key === 'provider') return detail.provider || '';
  if (key === 'result') return detail.failed ? 1 : 0;
  if (key === 'input') return detail.tokens.input_tokens;
  if (key === 'output') return detail.tokens.output_tokens;
  if (key === 'reasoning') return detail.tokens.reasoning_tokens;
  if (key === 'cacheRead') return getCacheReadTokens(detail);
  if (key === 'total') return getRequestTotalTokens(detail);
  if (key === 'latency') return detail.latency_ms || 0;
  if (key === 'ttft') return detail.ttft_ms || 0;
  return calculateCost(detail, modelPrices);
};

export function TrackerMonitoringPage() {
  const { t, i18n } = useTranslation();
  const isDark = useThemeStore((state) => state.resolvedTheme) === 'dark';
  const allDetails = useUsageStatsStore((state) => state.usageDetails);
  const [range, setRange] = useState<DateRangeState>(loadRange);
  const [draftRange, setDraftRange] = useState<DateRangeState>(range);
  const bounds = useMemo(() => rangeBounds(range), [range]);
  const exactRange = useMemo(
    () => (range.preset === 'custom' || range.preset === '5h' ? bounds : undefined),
    [bounds, range.preset]
  );
  const timeRange = range.preset === 'custom' || range.preset === '5h' ? undefined : range.preset;
  const { usage, loading, error, lastRefreshedAt, modelPrices, setModelPrices, loadUsage } =
    useUsageData({ timeRange, exactRange, refreshFullRange: true });
  const [granularity, setGranularity] = useState<MonitorGranularity>(() => {
    const stored = localStorage.getItem(GRANULARITY_STORAGE_KEY) as MonitorGranularity | null;
    return stored && ['minute', 'hour', 'day', 'week', 'month'].includes(stored) ? stored : 'hour';
  });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() =>
    addMonths(firstDayOfMonth(new Date()), -1)
  );
  const [selectingRangeEnd, setSelectingRangeEnd] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [globalSource, setGlobalSource] = useState('');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [shareMetric, setShareMetric] = useState<MonitorShareMetric>('requests');
  const [tokenDisplayMode, setTokenDisplayMode] = useState<TokenDisplayMode>('full');
  const [dimension, setDimension] = useState<MonitorDimension>('model');
  const [series, setSeries] = useState({
    input: true,
    output: true,
    cacheRead: true,
    cacheHit: true,
  });
  const [filters, setFilters] = useState({
    model: '',
    source: '',
    result: 'all' as MonitorResultFilter,
    search: '',
  });
  const [sortKey, setSortKey] = useState<RequestSortKey>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [visibleColumns, setVisibleColumns] = useState<RequestColumn[]>(loadColumns);
  const exportRef = useRef<HTMLDivElement>(null);
  const syncedModelsRef = useRef('');
  const modelPricesRef = useRef(modelPrices);
  const [priceSyncStatus, setPriceSyncStatus] = useState<'idle' | 'syncing' | 'success' | 'error'>(
    'idle'
  );

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    modelPricesRef.current = modelPrices;
  }, [modelPrices]);

  useEffect(() => {
    localStorage.setItem(RANGE_STORAGE_KEY, JSON.stringify(range));
  }, [range]);
  useEffect(() => {
    localStorage.setItem(GRANULARITY_STORAGE_KEY, granularity);
  }, [granularity]);
  useEffect(() => {
    localStorage.setItem(REQUEST_COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);
  useEffect(() => {
    setPage(1);
  }, [filters, pageSize, selectedModel]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node))
        setExportOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const allRangeDetails = useMemo(
    () => filterDetailsByRange(allDetails, bounds.startMs, bounds.endMs),
    [allDetails, bounds]
  );
  const rangeDetails = useMemo(
    () =>
      globalSource
        ? allRangeDetails.filter((detail) => detail.source === globalSource)
        : allRangeDetails,
    [allRangeDetails, globalSource]
  );
  const chartDetails = useMemo(
    () =>
      selectedModel
        ? rangeDetails.filter((detail) => detail.__modelName === selectedModel)
        : rangeDetails,
    [rangeDetails, selectedModel]
  );
  const dashboard = useMemo(
    () => buildMonitorDashboardData(chartDetails, modelPrices, granularity),
    [chartDetails, granularity, modelPrices]
  );
  const unfilteredDashboard = useMemo(
    () => buildMonitorDashboardData(rangeDetails, modelPrices, granularity),
    [granularity, modelPrices, rangeDetails]
  );
  const modelNames = useMemo(
    () =>
      Array.from(
        new Set(rangeDetails.map((detail) => detail.__modelName?.trim() || 'unknown'))
      ).sort((left, right) => left.localeCompare(right)),
    [rangeDetails]
  );

  useEffect(() => {
    const signature = modelNames.join('\n');
    if (!signature || syncedModelsRef.current === signature) return;
    syncedModelsRef.current = signature;
    let cancelled = false;
    setPriceSyncStatus('syncing');
    void syncPrices(modelNames, loadSyncSettings())
      .then((result) => {
        if (cancelled) return;
        if (result.matchedCount > 0) {
          setModelPrices({ ...modelPricesRef.current, ...result.prices });
        }
        setPriceSyncStatus(result.matchedCount > 0 ? 'success' : 'error');
      })
      .catch(() => {
        if (!cancelled) setPriceSyncStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [modelNames, setModelPrices]);

  const sources = useMemo(
    () =>
      Array.from(new Set(allRangeDetails.map((detail) => detail.source).filter(Boolean))).sort(),
    [allRangeDetails]
  );
  const filteredRequests = useMemo(() => {
    const nextFilters = { ...filters, model: filters.model || selectedModel };
    const filtered = filterMonitorRequests(rangeDetails, nextFilters);
    const direction = sortDirection === 'asc' ? 1 : -1;
    return filtered.sort((left, right) => {
      const a = requestSortValue(left, sortKey, modelPrices);
      const b = requestSortValue(right, sortKey, modelPrices);
      if (typeof a === 'string' || typeof b === 'string')
        return direction * String(a).localeCompare(String(b));
      return direction * (a - b);
    });
  }, [filters, modelPrices, rangeDetails, selectedModel, sortDirection, sortKey]);
  const pageCount = Math.max(1, Math.ceil(filteredRequests.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const requestPage = filteredRequests.slice((safePage - 1) * pageSize, safePage * pageSize);
  const dimensionRows =
    dimension === 'model'
      ? unfilteredDashboard.models.map((row) => ({ ...row, name: row.model }))
      : unfilteredDashboard.apiKeys;

  const chartColors = useMemo(
    () => ({
      text: isDark ? '#c9c3bb' : '#6d6760',
      grid: isDark ? 'rgba(201,195,187,.14)' : 'rgba(109,103,96,.14)',
    }),
    [isDark]
  );
  const visibleTrend = useMemo(() => {
    if (zoomLevel <= 1 || dashboard.trend.length < 2) return dashboard.trend;
    const visibleCount = Math.max(2, Math.ceil(dashboard.trend.length / zoomLevel));
    return dashboard.trend.slice(-visibleCount);
  }, [dashboard.trend, zoomLevel]);
  const trendLabels = visibleTrend.map((point) => formatDateLabel(point.timestamp, granularity));
  const trendData = {
    labels: trendLabels,
    datasets: [
      ...(series.input
        ? [
            {
              type: 'bar' as const,
              label: t('tracker_monitor.input'),
              data: visibleTrend.map((point) => point.input),
              backgroundColor: '#716dff',
              borderRadius: 4,
              borderSkipped: false,
              barPercentage: 0.72,
              categoryPercentage: 0.78,
              stack: 'tokens',
            },
          ]
        : []),
      ...(series.output
        ? [
            {
              type: 'bar' as const,
              label: t('tracker_monitor.output'),
              data: visibleTrend.map((point) => point.output),
              backgroundColor: '#3dbb91',
              borderRadius: 4,
              borderSkipped: false,
              barPercentage: 0.72,
              categoryPercentage: 0.78,
              stack: 'tokens',
            },
          ]
        : []),
      ...(series.cacheRead
        ? [
            {
              type: 'bar' as const,
              label: t('tracker_monitor.cache_read'),
              data: visibleTrend.map((point) => point.cacheRead),
              backgroundColor: '#e59b24',
              borderRadius: 4,
              borderSkipped: false,
              barPercentage: 0.72,
              categoryPercentage: 0.78,
              stack: 'tokens',
            },
          ]
        : []),
      ...(series.cacheHit
        ? [
            {
              type: 'line' as const,
              label: t('tracker_monitor.cache_hit'),
              data: visibleTrend.map((point) =>
                point.cacheHitRate === null ? null : point.cacheHitRate * 100
              ),
              borderColor: '#d45b9d',
              backgroundColor: '#d45b9d',
              borderDash: [6, 5],
              pointRadius: 2,
              yAxisID: 'percentage',
              tension: 0.28,
            },
          ]
        : []),
    ],
  };
  const shareRows = unfilteredDashboard.models.slice(0, 8);
  const shareValues = shareRows.map((row) => row[shareMetric]);
  const shareTotal = shareValues.reduce((sum, value) => sum + value, 0);
  const shareData = {
    labels: shareRows.map((row) => row.model),
    datasets: [
      {
        data: shareValues,
        backgroundColor: shareRows.map((_, index) => MODEL_COLORS[index % MODEL_COLORS.length]),
        borderWidth: 0,
        borderRadius: 3,
        spacing: 1,
        hoverOffset: 3,
      },
    ],
  };
  const costData = {
    labels: trendLabels,
    datasets: [
      {
        label: t('tracker_monitor.cost'),
        data: visibleTrend.map((point) => point.cost),
        borderColor: '#716dff',
        backgroundColor: 'rgba(113,109,255,.15)',
        fill: true,
        tension: 0.28,
        pointRadius: 2,
      },
    ],
  };
  const efficiencyRows = dashboard.models.filter(
    (row) => row.averageLatencyMs !== null && row.requests > 0
  );
  const efficiencyData = {
    datasets: efficiencyRows.map((row, index) => ({
      label: row.model,
      data: [{ x: row.tokens / row.requests, y: row.averageLatencyMs || 0 }],
      backgroundColor: MODEL_COLORS[index % MODEL_COLORS.length],
      pointRadius: Math.min(18, 5 + Math.sqrt(row.requests)),
      pointHoverRadius: Math.min(21, 7 + Math.sqrt(row.requests)),
    })),
  };

  const toggleSort = (key: RequestSortKey) => {
    if (sortKey === key) setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDirection(key === 'model' || key === 'source' ? 'asc' : 'desc');
    }
  };
  const openRangePicker = () => {
    const selectedEnd = dateInputToLocalDate(range.end);
    setDraftRange(range);
    setCalendarMonth(addMonths(firstDayOfMonth(selectedEnd), -1));
    setSelectingRangeEnd(false);
    setRangeOpen((open) => !open);
  };
  const selectCalendarDate = (date: Date) => {
    const value = toDateInput(date);
    if (!selectingRangeEnd || draftRange.preset !== 'custom') {
      setDraftRange({ preset: 'custom', start: value, end: value });
      setSelectingRangeEnd(true);
      return;
    }
    const start = value < draftRange.start ? value : draftRange.start;
    const end = value < draftRange.start ? draftRange.start : value;
    setDraftRange({ preset: 'custom', start, end });
    setSelectingRangeEnd(false);
  };
  const selectQuickRange = (kind: '5h' | '7d' | '30d' | 'month') => {
    const today = new Date();
    const end = toDateInput(today);
    if (kind === '5h') {
      setDraftRange({ preset: '5h', start: end, end });
      setSelectingRangeEnd(false);
      return;
    }
    const start = new Date(today);
    if (kind === 'month') start.setDate(1);
    else start.setDate(start.getDate() - (kind === '7d' ? 6 : 29));
    setDraftRange({ preset: 'custom', start: toDateInput(start), end });
    setSelectingRangeEnd(false);
  };
  const resetRangeToToday = () => {
    const today = new Date();
    const value = toDateInput(today);
    setDraftRange({ preset: 'custom', start: value, end: value });
    setCalendarMonth(addMonths(firstDayOfMonth(today), -1));
    setSelectingRangeEnd(false);
  };
  const applyRange = () => {
    if (draftRange.preset === 'custom' && draftRange.start > draftRange.end) {
      setDraftRange((current) => ({ ...current, start: current.end, end: current.start }));
      setRange({ ...draftRange, start: draftRange.end, end: draftRange.start });
    } else setRange(draftRange);
    setRangeOpen(false);
  };
  const exportCsv = () => {
    downloadBlob({
      blob: new Blob([buildMonitorRequestsCsv(filteredRequests)], {
        type: 'text/csv;charset=utf-8',
      }),
      filename: `usage-${Date.now()}.csv`,
    });
    setExportOpen(false);
  };
  const exportJson = () => {
    downloadBlob({
      blob: new Blob([JSON.stringify(filteredRequests, null, 2)], { type: 'application/json' }),
      filename: `usage-${Date.now()}.json`,
    });
    setExportOpen(false);
  };
  const rangeLabel =
    range.preset === 'custom'
      ? range.start === range.end
        ? new Date(`${range.start}T00:00:00`).toLocaleDateString()
        : `${new Date(`${range.start}T00:00:00`).toLocaleDateString()} – ${new Date(`${range.end}T00:00:00`).toLocaleDateString()}`
      : t(`tracker_monitor.range_${range.preset}`);
  const pricingCoverage = unfilteredDashboard.summary.totalRequests
    ? (unfilteredDashboard.summary.pricedRequests / unfilteredDashboard.summary.totalRequests) * 100
    : 0;

  return (
    <div className={styles.page}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingIndicator}>
            <LoadingSpinner size={30} />
            <span>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <header className={styles.header}>
        <div className={styles.heading}>
          <h1>{t('tracker_monitor.title')}</h1>
          <p>{t('tracker_monitor.subtitle')}</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.rangeWrap}>
            <button
              className={styles.controlButton}
              type="button"
              onClick={openRangePicker}
              aria-expanded={rangeOpen}
            >
              <svg className={styles.calendarIcon} viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18" />
              </svg>
              <strong>{rangeLabel}</strong>
            </button>
            {rangeOpen && (
              <div
                className={styles.rangePopover}
                role="dialog"
                aria-label={t('tracker_monitor.date_range')}
              >
                <div className={styles.calendarTop}>
                  <div>
                    <h2>{t('tracker_monitor.select_date_range')}</h2>
                    <span>
                      {draftRange.start === draftRange.end
                        ? dateInputToLocalDate(draftRange.start).toLocaleDateString()
                        : `${dateInputToLocalDate(draftRange.start).toLocaleDateString()} – ${dateInputToLocalDate(draftRange.end).toLocaleDateString()}`}
                    </span>
                  </div>
                  <div className={styles.calendarQuickRanges}>
                    <button type="button" onClick={() => selectQuickRange('5h')}>
                      {t('tracker_monitor.last_5_hours')}
                    </button>
                    <button type="button" onClick={() => selectQuickRange('7d')}>
                      {t('tracker_monitor.last_7_days')}
                    </button>
                    <button type="button" onClick={() => selectQuickRange('30d')}>
                      {t('tracker_monitor.last_30_days')}
                    </button>
                    <button type="button" onClick={() => selectQuickRange('month')}>
                      {t('tracker_monitor.current_month')}
                    </button>
                  </div>
                </div>
                <div className={styles.calendarMonths}>
                  <CalendarMonth
                    month={calendarMonth}
                    range={draftRange}
                    onSelect={selectCalendarDate}
                    onPrevious={() => setCalendarMonth((month) => addMonths(month, -1))}
                  />
                  <CalendarMonth
                    month={addMonths(calendarMonth, 1)}
                    range={draftRange}
                    onSelect={selectCalendarDate}
                    onNext={() => setCalendarMonth((month) => addMonths(month, 1))}
                  />
                </div>
                <div className={styles.calendarActions}>
                  <Button variant="secondary" onClick={() => setRangeOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="secondary" onClick={resetRangeToToday}>
                    {t('tracker_monitor.reset_today')}
                  </Button>
                  <Button variant="primary" onClick={applyRange}>
                    {t('common.confirm')}
                  </Button>
                </div>
              </div>
            )}
          </div>
          <Select
            value={granularity}
            options={(['minute', 'hour', 'day', 'week', 'month'] as MonitorGranularity[]).map(
              (value) => ({ value, label: t(`tracker_monitor.${value}`) })
            )}
            onChange={(value) => setGranularity(value as MonitorGranularity)}
            ariaLabel={t('tracker_monitor.granularity')}
            className={styles.headerSelect}
            dropdownClassName={styles.trackerSelectDropdown}
            fullWidth={false}
          />
          <Select
            value={globalSource}
            options={[
              { value: '', label: t('tracker_monitor.all_sources') },
              ...sources.map((source) => ({ value: source, label: source })),
            ]}
            onChange={setGlobalSource}
            ariaLabel={t('tracker_monitor.all_sources')}
            className={`${styles.headerSelect} ${styles.sourceHeaderSelect}`}
            dropdownClassName={styles.trackerSelectDropdown}
            fullWidth={false}
          />
          <Button variant="secondary" size="sm" onClick={() => setPricingOpen(true)}>
            {t('tracker_monitor.model_prices')}
          </Button>
          <div className={styles.exportWrap} ref={exportRef}>
            <Button variant="secondary" size="sm" onClick={() => setExportOpen((open) => !open)}>
              {t('tracker_monitor.export')}
            </Button>
            {exportOpen && (
              <div className={styles.exportMenu}>
                <button type="button" onClick={exportCsv}>
                  {t('tracker_monitor.export_csv')}
                </button>
                <button type="button" onClick={exportJson}>
                  {t('tracker_monitor.export_json')}
                </button>
              </div>
            )}
          </div>
          <Button variant="primary" size="sm" onClick={() => void loadUsage()} disabled={loading}>
            {loading ? t('common.loading') : t('tracker_monitor.refresh')}
          </Button>
        </div>
      </header>

      <div className={styles.feedback}>
        <span className={styles.statusDot} />
        <span>
          {error ||
            (priceSyncStatus === 'syncing'
              ? t('tracker_monitor.syncing_prices')
              : lastRefreshedAt
                ? `${t('tracker_monitor.updated')} ${lastRefreshedAt.toLocaleTimeString()}`
                : t('tracker_monitor.ready'))}
        </span>
      </div>
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        <MetricCard
          label={t('tracker_monitor.total_tokens')}
          labelAction={
            <button
              type="button"
              className={styles.metricSwitch}
              onClick={() =>
                setTokenDisplayMode((mode) => (mode === 'full' ? 'k' : mode === 'k' ? 'm' : 'full'))
              }
              aria-label={`${t('tracker_monitor.total_tokens')}: ${tokenDisplayMode}`}
            >
              {tokenDisplayMode === 'full' ? 'Full' : tokenDisplayMode}
            </button>
          }
          value={formatTokenTotal(
            unfilteredDashboard.summary.totalTokens,
            tokenDisplayMode,
            i18n.language
          )}
          detail={t('tracker_monitor.token_detail')}
        />
        <MetricCard
          label={t('tracker_monitor.estimated_cost')}
          value={formatUsd(unfilteredDashboard.summary.totalCost)}
          detail={t('tracker_monitor.price_coverage', { value: pricingCoverage.toFixed(0) })}
        />
        <MetricCard
          label={t('tracker_monitor.total_requests')}
          value={unfilteredDashboard.summary.totalRequests.toLocaleString()}
          detail={t('tracker_monitor.failed_count', {
            value: unfilteredDashboard.summary.failedRequests.toLocaleString(),
          })}
        />
        <MetricCard
          label={t('tracker_monitor.top_model')}
          value={unfilteredDashboard.summary.topModel || '—'}
          detail={t('tracker_monitor.by_requests')}
          model
        />
      </section>

      <section className={styles.primaryGrid}>
        <Panel
          title={t('tracker_monitor.token_trend')}
          subtitle={
            selectedModel
              ? t('tracker_monitor.filtered_model', { model: selectedModel })
              : t('tracker_monitor.token_trend_subtitle')
          }
          extra={
            <div className={styles.trendControls}>
              <div className={styles.seriesLegend}>
                {Object.entries(series).map(([key, enabled]) => (
                  <button
                    type="button"
                    key={key}
                    className={enabled ? styles.legendEnabled : ''}
                    onClick={() => setSeries((current) => ({ ...current, [key]: !enabled }))}
                  >
                    <i
                      className={key === 'cacheHit' ? styles.lineSwatch : styles.seriesSwatch}
                      data-series={key}
                    />
                    {t(`tracker_monitor.series_${key}`)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.resetModelButton}
                onClick={() => setSelectedModel('')}
                aria-hidden={!selectedModel}
                tabIndex={selectedModel ? 0 : -1}
              >
                {t('tracker_monitor.show_all')}
              </button>
              <div className={styles.zoomButtons}>
                <button
                  type="button"
                  onClick={() => setZoomLevel((level) => Math.max(1, level - 1))}
                  disabled={zoomLevel <= 1}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => setZoomLevel((level) => Math.min(6, level + 1))}
                  disabled={zoomLevel >= 6 || dashboard.trend.length < 3}
                >
                  ＋
                </button>
              </div>
            </div>
          }
        >
          <div className={styles.chartArea}>
            {dashboard.trend.length ? (
              <Chart
                type="bar"
                data={trendData as never}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { intersect: false, mode: 'index' },
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      enabled: false,
                      external: (context) => {
                        const point =
                          visibleTrend[context.tooltip.dataPoints?.[0]?.dataIndex ?? -1];
                        if (!point) {
                          renderMonitorTooltip(context, '', []);
                          return;
                        }
                        const rows: MonitorTooltipRow[] = [];
                        if (series.input)
                          rows.push({
                            label: t('tracker_monitor.input'),
                            value: formatCompactNumber(point.input),
                            color: '#716dff',
                          });
                        if (series.output)
                          rows.push({
                            label: t('tracker_monitor.output'),
                            value: formatCompactNumber(point.output),
                            color: '#3dbb91',
                          });
                        if (series.cacheRead)
                          rows.push({
                            label: t('tracker_monitor.cache_read'),
                            value: formatCompactNumber(point.cacheRead),
                            color: '#e59b24',
                          });
                        if (series.cacheHit)
                          rows.push({
                            label: t('tracker_monitor.cache_hit'),
                            value:
                              point.cacheHitRate === null
                                ? '—'
                                : `${(point.cacheHitRate * 100).toFixed(1)}%`,
                            color: '#d45b9d',
                          });
                        rows.push(
                          {
                            label: t('tracker_monitor.total_tokens'),
                            value: formatCompactNumber(
                              point.input + point.output + point.cacheRead
                            ),
                          },
                          {
                            label: t('tracker_monitor.requests_short'),
                            value: point.requests.toLocaleString(),
                          },
                          {
                            label: t('tracker_monitor.exact_cost'),
                            value: formatUsd(point.cost),
                          },
                          {
                            label: t('tracker_monitor.price_coverage_label'),
                            value: `${point.pricedRequests.toLocaleString()} / ${point.requests.toLocaleString()}`,
                          }
                        );
                        renderMonitorTooltip(
                          context,
                          formatDateLabel(point.timestamp, granularity),
                          rows
                        );
                      },
                    },
                  },
                  scales: {
                    x: {
                      stacked: true,
                      ticks: { color: chartColors.text, maxRotation: 0 },
                      grid: { display: false },
                    },
                    y: {
                      stacked: true,
                      beginAtZero: true,
                      ticks: {
                        color: chartColors.text,
                        callback: (value) => formatCompactNumber(Number(value)),
                      },
                      grid: { color: chartColors.grid },
                    },
                    percentage: {
                      position: 'right',
                      beginAtZero: true,
                      max: 100,
                      ticks: { color: '#d45b9d', callback: (value) => `${value}%` },
                      grid: { display: false },
                    },
                  },
                }}
              />
            ) : (
              <Empty />
            )}
          </div>
          <div className={styles.zoomTip}>{t('tracker_monitor.zoom_tip')}</div>
        </Panel>

        <Panel
          title={t('tracker_monitor.model_share')}
          subtitle={t('tracker_monitor.model_share_subtitle')}
          extra={
            <div className={styles.shareHeaderMeta}>
              <div className={styles.metricSwitch}>
                {(['requests', 'tokens', 'cost'] as MonitorShareMetric[]).map((metric) => (
                  <button
                    type="button"
                    key={metric}
                    className={shareMetric === metric ? styles.activeChoice : ''}
                    onClick={() => setShareMetric(metric)}
                  >
                    {t(`tracker_monitor.metric_${metric}`)}
                  </button>
                ))}
              </div>
              <span>{t('tracker_monitor.model_count', { value: shareRows.length })}</span>
            </div>
          }
        >
          <div className={styles.donutLayout}>
            <div className={styles.donut}>
              {shareRows.length ? (
                <>
                  <Doughnut
                    data={shareData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: '68%',
                      animation: false,
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          enabled: false,
                          external: (context) => {
                            const row = shareRows[context.tooltip.dataPoints?.[0]?.dataIndex ?? -1];
                            if (!row) {
                              renderMonitorTooltip(context, '', []);
                              return;
                            }
                            const metricValue = row[shareMetric];
                            renderMonitorTooltip(context, row.model, [
                              {
                                label: t(`tracker_monitor.metric_${shareMetric}`),
                                value:
                                  shareMetric === 'cost'
                                    ? formatUsd(metricValue)
                                    : formatCompactNumber(metricValue),
                              },
                              {
                                label: t('tracker_monitor.share'),
                                value:
                                  shareTotal > 0
                                    ? `${((metricValue / shareTotal) * 100).toFixed(2)}%`
                                    : '0%',
                              },
                              {
                                label: t('tracker_monitor.requests_short'),
                                value: row.requests.toLocaleString(),
                              },
                              {
                                label: t('tracker_monitor.total_tokens'),
                                value: formatCompactNumber(row.tokens),
                              },
                              {
                                label: t('tracker_monitor.exact_cost'),
                                value: formatUsd(row.cost),
                              },
                            ]);
                          },
                        },
                      },
                    }}
                  />
                  <div className={styles.donutCenter}>
                    <strong>
                      {shareMetric === 'cost'
                        ? formatUsd(shareTotal)
                        : formatCompactNumber(shareTotal)}
                    </strong>
                    <span>{t(`tracker_monitor.metric_${shareMetric}`)}</span>
                  </div>
                </>
              ) : (
                <Empty />
              )}
            </div>
            <div className={styles.legendList}>
              {shareRows.map((row, index) => (
                <button
                  type="button"
                  key={row.model}
                  className={selectedModel === row.model ? styles.selectedLegend : ''}
                  onClick={() =>
                    setSelectedModel((current) => (current === row.model ? '' : row.model))
                  }
                >
                  <i style={{ background: MODEL_COLORS[index % MODEL_COLORS.length] }} />
                  <span>
                    <strong>{row.model}</strong>
                    <small>
                      {row.requests.toLocaleString()} {t('tracker_monitor.requests_short')} ·{' '}
                      {formatCompactNumber(row.tokens)} {t('tracker_monitor.tokens_short')}
                    </small>
                  </span>
                  <b>
                    {shareTotal > 0
                      ? `${((row[shareMetric] / shareTotal) * 100).toFixed(1)}%`
                      : '0%'}
                  </b>
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </section>

      <section className={styles.secondaryGrid}>
        <Panel
          title={t('tracker_monitor.cost_trend')}
          subtitle={t('tracker_monitor.cost_trend_subtitle')}
        >
          <div className={styles.smallChart}>
            {dashboard.trend.some((point) => point.cost > 0) ? (
              <Line
                data={costData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      enabled: false,
                      external: (context) => {
                        const point =
                          visibleTrend[context.tooltip.dataPoints?.[0]?.dataIndex ?? -1];
                        if (!point) {
                          renderMonitorTooltip(context, '', []);
                          return;
                        }
                        renderMonitorTooltip(
                          context,
                          formatDateLabel(point.timestamp, granularity),
                          [
                            {
                              label: t('tracker_monitor.exact_cost'),
                              value: formatUsd(point.cost),
                            },
                            {
                              label: t('tracker_monitor.input'),
                              value: formatUsd(point.inputCost),
                            },
                            {
                              label: t('tracker_monitor.output'),
                              value: formatUsd(point.outputCost),
                            },
                            {
                              label: t('tracker_monitor.cache_read'),
                              value: formatUsd(point.cacheReadCost),
                            },
                            {
                              label: t('tracker_monitor.cache_creation'),
                              value: formatUsd(point.cacheCreationCost),
                            },
                            {
                              label: t('tracker_monitor.price_coverage_label'),
                              value: `${point.pricedRequests.toLocaleString()} / ${point.requests.toLocaleString()}`,
                            },
                          ]
                        );
                      },
                    },
                  },
                  scales: {
                    x: {
                      ticks: { color: chartColors.text, maxRotation: 0 },
                      grid: { display: false },
                    },
                    y: {
                      beginAtZero: true,
                      ticks: { color: chartColors.text, callback: (value) => `$${value}` },
                      grid: { color: chartColors.grid },
                    },
                  },
                }}
              />
            ) : (
              <Empty text={t('tracker_monitor.no_price_data')} />
            )}
          </div>
        </Panel>
        <Panel
          title={t('tracker_monitor.efficiency')}
          subtitle={t('tracker_monitor.efficiency_subtitle')}
        >
          <div className={styles.smallChart}>
            {efficiencyRows.length ? (
              <Scatter
                data={efficiencyData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      enabled: false,
                      external: (context) => {
                        const row =
                          efficiencyRows[context.tooltip.dataPoints?.[0]?.datasetIndex ?? -1];
                        if (!row) {
                          renderMonitorTooltip(context, '', []);
                          return;
                        }
                        renderMonitorTooltip(context, row.model, [
                          {
                            label: t('tracker_monitor.average_tokens'),
                            value: formatCompactNumber(row.tokens / row.requests),
                          },
                          {
                            label: t('tracker_monitor.average_latency'),
                            value: formatDurationMs(row.averageLatencyMs),
                          },
                          {
                            label: t('tracker_monitor.requests_short'),
                            value: row.requests.toLocaleString(),
                          },
                          {
                            label: t('tracker_monitor.total_tokens'),
                            value: formatCompactNumber(row.tokens),
                          },
                        ]);
                      },
                    },
                  },
                  scales: {
                    x: {
                      title: {
                        display: true,
                        text: t('tracker_monitor.tokens_per_request'),
                        color: chartColors.text,
                      },
                      ticks: { color: chartColors.text },
                      grid: { color: chartColors.grid },
                    },
                    y: {
                      title: {
                        display: true,
                        text: t('tracker_monitor.latency'),
                        color: chartColors.text,
                      },
                      ticks: { color: chartColors.text },
                      grid: { color: chartColors.grid },
                    },
                  },
                }}
              />
            ) : (
              <Empty />
            )}
          </div>
        </Panel>
      </section>

      <Panel
        title={t('tracker_monitor.request_details')}
        subtitle={t('tracker_monitor.request_details_subtitle')}
        className={styles.tablePanel}
        extra={
          <div className={styles.tableToolbar}>
            <input
              className={styles.searchInput}
              value={filters.search}
              onChange={(event) =>
                setFilters((current) => ({ ...current, search: event.target.value }))
              }
              placeholder={t('tracker_monitor.search')}
            />
            <select
              value={filters.model}
              onChange={(event) =>
                setFilters((current) => ({ ...current, model: event.target.value }))
              }
            >
              <option value="">{t('tracker_monitor.all_models')}</option>
              {modelNames.map((model) => (
                <option key={model}>{model}</option>
              ))}
            </select>
            <select
              value={filters.source}
              onChange={(event) =>
                setFilters((current) => ({ ...current, source: event.target.value }))
              }
            >
              <option value="">{t('tracker_monitor.all_sources')}</option>
              {sources.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
            <select
              value={filters.result}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  result: event.target.value as MonitorResultFilter,
                }))
              }
            >
              <option value="all">{t('tracker_monitor.all_results')}</option>
              <option value="success">{t('tracker_monitor.success')}</option>
              <option value="failed">{t('tracker_monitor.failed')}</option>
            </select>
            <label>
              {t('tracker_monitor.rows')}
              <input
                type="number"
                min={1}
                max={500}
                value={pageSize}
                onChange={(event) =>
                  setPageSize(Math.min(500, Math.max(1, Number(event.target.value) || 100)))
                }
              />
            </label>
            <div className={styles.columnsWrap}>
              <button type="button" onClick={() => setColumnsOpen((open) => !open)}>
                {t('tracker_monitor.columns')}
              </button>
              {columnsOpen && (
                <div className={styles.columnsMenu}>
                  {ALL_COLUMNS.map((column) => (
                    <label key={column}>
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(column)}
                        onChange={() =>
                          setVisibleColumns((current) =>
                            current.includes(column)
                              ? current.filter((item) => item !== column)
                              : [...current, column]
                          )
                        }
                      />
                      {t(`tracker_monitor.column_${column}`)}
                    </label>
                  ))}
                  <button type="button" onClick={() => setVisibleColumns(ALL_COLUMNS)}>
                    {t('tracker_monitor.show_all')}
                  </button>
                </div>
              )}
            </div>
          </div>
        }
      >
        <div className={styles.tableScroll}>
          <table
            className={styles.requestTable}
            style={{
              width: visibleColumns.reduce(
                (total, column) => total + REQUEST_COLUMN_WIDTHS[column],
                0
              ),
            }}
          >
            <colgroup>
              {visibleColumns.map((column) => (
                <col key={column} style={{ width: REQUEST_COLUMN_WIDTHS[column] }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {visibleColumns.map((column) => (
                  <th key={column} data-column={column}>
                    <button type="button" onClick={() => toggleSort(column as RequestSortKey)}>
                      <span>{t(`tracker_monitor.column_${column}`)}</span>
                      <i className={styles.sortIndicator} aria-hidden="true">
                        {sortKey === column ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                      </i>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requestPage.length ? (
                requestPage.map((detail, index) => (
                  <RequestRow
                    key={detail.id || `${detail.timestamp}-${index}`}
                    detail={detail}
                    columns={visibleColumns}
                    modelPrices={modelPrices}
                    t={t}
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={visibleColumns.length}>
                    <Empty />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.pagination}>
          <span>
            {t('tracker_monitor.filtered_rows', {
              value: filteredRequests.length.toLocaleString(),
            })}
          </span>
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={safePage <= 1}
            >
              {t('tracker_monitor.previous')}
            </Button>
            <span>
              {safePage} / {pageCount}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={safePage >= pageCount}
            >
              {t('tracker_monitor.next')}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel
        title={t('tracker_monitor.dimension_details')}
        subtitle={t('tracker_monitor.dimension_subtitle')}
        className={styles.tablePanel}
        extra={
          <div className={styles.metricSwitch}>
            <button
              type="button"
              className={dimension === 'model' ? styles.activeChoice : ''}
              onClick={() => setDimension('model')}
            >
              {t('tracker_monitor.by_model')}
            </button>
            <button
              type="button"
              className={dimension === 'apiKey' ? styles.activeChoice : ''}
              onClick={() => setDimension('apiKey')}
            >
              {t('tracker_monitor.by_api_key')}
            </button>
          </div>
        }
      >
        <div className={styles.tableScroll}>
          <table className={styles.dimensionTable}>
            <colgroup>
              <col style={{ width: 230 }} />
              {Array.from({ length: 8 }, (_, index) => (
                <col key={index} style={{ width: 125 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th>
                  {dimension === 'model'
                    ? t('tracker_monitor.column_model')
                    : t('tracker_monitor.api_key')}
                </th>
                <th>{t('tracker_monitor.requests_short')}</th>
                <th>{t('tracker_monitor.failed')}</th>
                <th>{t('tracker_monitor.input')}</th>
                <th>{t('tracker_monitor.output')}</th>
                <th>{t('tracker_monitor.cache_read')}</th>
                <th>{t('tracker_monitor.total_tokens')}</th>
                <th>{t('tracker_monitor.latency')}</th>
                <th>{t('tracker_monitor.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {dimensionRows.map((row) => (
                <tr key={row.name}>
                  <td className={styles.nameCell}>{row.name || '—'}</td>
                  <td>{row.requests.toLocaleString()}</td>
                  <td>{row.failed.toLocaleString()}</td>
                  <td>{formatCompactNumber(row.input)}</td>
                  <td>{formatCompactNumber(row.output)}</td>
                  <td>{formatCompactNumber(row.cacheRead)}</td>
                  <td>{formatCompactNumber(row.tokens)}</td>
                  <td>{formatDurationMs(row.averageLatencyMs)}</td>
                  <td>{formatUsd(row.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        open={pricingOpen}
        onClose={() => setPricingOpen(false)}
        title={t('tracker_monitor.model_prices')}
        width="min(1120px, calc(100vw - 32px))"
      >
        <PriceSettingsCard
          modelNames={modelNames}
          modelPrices={modelPrices}
          onPricesChange={setModelPrices}
        />
      </Modal>
    </div>
  );
}

function CalendarMonth({
  month,
  range,
  onSelect,
  onPrevious,
  onNext,
}: {
  month: Date;
  range: DateRangeState;
  onSelect: (date: Date) => void;
  onPrevious?: () => void;
  onNext?: () => void;
}) {
  const { t } = useTranslation();
  const days = calendarDays(month);
  const today = toDateInput(new Date());
  const weekdays = Array.from({ length: 7 }, (_, index) =>
    new Date(2026, 7, 2 + index).toLocaleDateString(undefined, { weekday: 'short' })
  );
  return (
    <section className={styles.calendarPanel}>
      <div className={styles.calendarMonthHeader}>
        {onPrevious ? (
          <button
            type="button"
            onClick={onPrevious}
            aria-label={t('tracker_monitor.previous_month')}
          >
            ‹
          </button>
        ) : (
          <span />
        )}
        <strong>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
        {onNext ? (
          <button type="button" onClick={onNext} aria-label={t('tracker_monitor.next_month')}>
            ›
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className={styles.calendarWeekdays}>
        {weekdays.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>
      <div className={styles.calendarGrid}>
        {days.map((date, index) => {
          if (!date) return <span key={`blank-${index}`} className={styles.calendarBlank} />;
          const value = toDateInput(date);
          const selected = value === range.start || value === range.end;
          const inRange = range.preset === 'custom' && value > range.start && value < range.end;
          const future = value > today;
          return (
            <button
              key={value}
              type="button"
              className={`${styles.calendarDay} ${selected ? styles.calendarSelected : ''} ${inRange ? styles.calendarInRange : ''} ${value === today ? styles.calendarToday : ''}`}
              onClick={() => onSelect(date)}
              disabled={future}
              aria-pressed={selected}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  model = false,
  labelAction,
}: {
  label: string;
  value: string;
  detail: string;
  model?: boolean;
  labelAction?: React.ReactNode;
}) {
  return (
    <article className={styles.metricCard}>
      <div className={styles.metricLabel}>
        <span>{label}</span>
        {labelAction}
      </div>
      <div className={`${styles.metricValue} ${model ? styles.modelValue : ''}`}>
        {model && <span className={styles.modelBadge}>AI</span>}
        {value}
      </div>
      <div className={styles.metricDetail}>{detail}</div>
    </article>
  );
}

function Panel({
  title,
  subtitle,
  extra,
  children,
  className = '',
}: {
  title: string;
  subtitle: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article className={`${styles.panel} ${className}`}>
      <div className={styles.panelHeader}>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {extra}
      </div>
      {children}
    </article>
  );
}

function Empty({ text }: { text?: string }) {
  const { t } = useTranslation();
  return <div className={styles.empty}>{text || t('tracker_monitor.no_data')}</div>;
}

function RequestRow({
  detail,
  columns,
  modelPrices,
  t,
}: {
  detail: UsageDetail;
  columns: RequestColumn[];
  modelPrices: Parameters<typeof calculateCost>[1];
  t: ReturnType<typeof useTranslation>['t'];
}) {
  const values: Record<RequestColumn, React.ReactNode> = {
    timestamp: new Date(detail.__timestampMs ?? detail.timestamp).toLocaleString(),
    model: detail.__modelName || 'unknown',
    source: detail.source || '—',
    provider: detail.provider || '—',
    result: (
      <span className={`${styles.badge} ${detail.failed ? styles.failedBadge : ''}`}>
        {detail.failed ? t('tracker_monitor.failed') : t('tracker_monitor.success')}
      </span>
    ),
    input: formatCompactNumber(detail.tokens.input_tokens),
    output: formatCompactNumber(detail.tokens.output_tokens),
    reasoning: formatCompactNumber(detail.tokens.reasoning_tokens),
    cacheRead: formatCompactNumber(getCacheReadTokens(detail)),
    total: formatCompactNumber(getRequestTotalTokens(detail)),
    latency: formatDurationMs(detail.latency_ms),
    ttft: formatDurationMs(detail.ttft_ms),
    cost: formatUsd(calculateCost(detail, modelPrices)),
  };
  return (
    <tr>
      {columns.map((column) => (
        <td key={column} data-column={column} className={column === 'model' ? styles.nameCell : ''}>
          {values[column]}
        </td>
      ))}
    </tr>
  );
}
