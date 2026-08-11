import { describe, expect, test } from 'bun:test';
import {
  buildMonitorDashboardData,
  buildMonitorRequestsCsv,
  filterDetailsByRange,
  filterMonitorRequests,
} from '../src/utils/monitorDashboard';
import type { UsageDetail } from '../src/utils/usage';

const detail = (overrides: Partial<UsageDetail> = {}): UsageDetail => ({
  id: 'request-1',
  timestamp: '2026-01-02T10:15:00Z',
  __timestampMs: Date.parse('2026-01-02T10:15:00Z'),
  __modelName: 'gpt-test',
  source: 'cli',
  auth_index: 'key-1',
  provider: 'openai',
  latency_ms: 1200,
  ttft_ms: 200,
  failed: false,
  tokens: {
    input_tokens: 100,
    output_tokens: 50,
    reasoning_tokens: 10,
    cached_tokens: 20,
    cache_read_tokens: 20,
    cache_creation_tokens: 0,
    total_tokens: 160,
  },
  ...overrides,
});

describe('monitor dashboard aggregation', () => {
  test('builds summaries, time buckets, dimensions, and estimated costs', () => {
    const data = buildMonitorDashboardData(
      [detail(), detail({ id: 'request-2', failed: true, __modelName: 'claude-test' })],
      {
        'gpt-test': { input: 1, output: 2, cacheRead: 0.5, cacheCreate: 0 },
        'claude-test': { input: 1, output: 2, cacheRead: 0.5, cacheCreate: 0 },
      },
      'hour'
    );

    expect(data.summary.totalRequests).toBe(2);
    expect(data.summary.failedRequests).toBe(1);
    expect(data.summary.totalTokens).toBe(320);
    expect(data.summary.pricedRequests).toBe(2);
    expect(data.trend).toHaveLength(1);
    expect(data.models).toHaveLength(2);
    expect(data.apiKeys[0]?.requests).toBe(2);
    expect(data.summary.totalCost).toBeGreaterThan(0);
  });

  test('uses the request total fallback when total_tokens is missing', () => {
    const data = buildMonitorDashboardData(
      [detail({ tokens: { ...detail().tokens, total_tokens: 0 } })],
      {},
      'day'
    );
    expect(data.summary.totalTokens).toBe(160);
  });
});

describe('monitor range and request filters', () => {
  test('uses a left-closed, right-open range', () => {
    const start = Date.parse('2026-01-02T10:00:00Z');
    const end = Date.parse('2026-01-02T11:00:00Z');
    const rows = [
      detail({ id: 'inside', __timestampMs: start }),
      detail({ id: 'end', __timestampMs: end }),
    ];
    expect(filterDetailsByRange(rows, start, end).map((row) => row.id)).toEqual(['inside']);
  });

  test('filters by model, source, result, and text', () => {
    const rows = [
      detail(),
      detail({ id: 'failed', __modelName: 'claude-test', source: 'web', failed: true }),
    ];
    expect(
      filterMonitorRequests(rows, {
        model: 'claude-test',
        source: 'web',
        result: 'failed',
        search: 'claude',
      })
    ).toHaveLength(1);
    expect(
      filterMonitorRequests(rows, { model: '', source: '', result: 'success', search: 'cli' })
    ).toHaveLength(1);
  });
});

describe('monitor CSV export', () => {
  test('exports normalized request fields and escapes cells', () => {
    const csv = buildMonitorRequestsCsv([detail({ source: 'cli,"quoted"' })]);
    expect(csv).toContain('timestamp,model,source');
    expect(csv).toContain('"cli,""quoted"""');
    expect(csv).toContain('gpt-test');
  });

  test('neutralizes spreadsheet formulas', () => {
    const csv = buildMonitorRequestsCsv([detail({ source: '=HYPERLINK("https://example.com")' })]);
    expect(csv).toContain("'=HYPERLINK");
  });
});
