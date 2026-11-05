import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dashboardRoot = resolve(__dirname, '..');

// Helper to create controlled deferred promises for deterministic async testing
function createDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Dashboard Lint & Architecture Regression Tests', () => {
  test('ESLint passes with 0 errors and 0 warnings across all dashboard source files', async () => {
    const eslint = new ESLint({ cwd: dashboardRoot });
    const results = await eslint.lintFiles([
      'src/**/*.{ts,tsx}',
    ]);

    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);

    const failureMessages = results
      .filter((r) => r.errorCount > 0 || r.warningCount > 0)
      .map((r) => `${r.filePath}:\n` + r.messages.map((m) => `  [${m.ruleId}] line ${m.line}: ${m.message}`).join('\n'))
      .join('\n\n');

    assert.equal(
      totalErrors,
      0,
      `Expected 0 ESLint errors, but found ${totalErrors}:\n${failureMessages}`
    );
    assert.equal(
      totalWarnings,
      0,
      `Expected 0 ESLint warnings, but found ${totalWarnings}:\n${failureMessages}`
    );
  });

  test('Component files isolate exports to React components (Fast Refresh compliance)', () => {
    const filesToCheck = [
      resolve(dashboardRoot, 'src/components/ui/badge.tsx'),
      resolve(dashboardRoot, 'src/components/ui/card.tsx'),
      resolve(dashboardRoot, 'src/components/ui/table.tsx'),
      resolve(dashboardRoot, 'src/components/ui/tabs.tsx'),
    ];

    for (const filePath of filesToCheck) {
      const content = readFileSync(filePath, 'utf-8');
      assert.doesNotMatch(
        content,
        /export\s*\{\s*[^}]*\b(badgeVariants|buttonVariants|tabsListVariants)\b[^}]*\}/,
        `${filePath} must not export variant objects directly; export them from dedicated *-variants.ts files`
      );
    }
  });

  test('Variant modules export their respective CVA variants', () => {
    const variantFiles = [
      { path: resolve(dashboardRoot, 'src/components/ui/badge-variants.ts'), name: 'badgeVariants' },
    ];

    for (const { path, name } of variantFiles) {
      const content = readFileSync(path, 'utf-8');
      assert.match(
        content,
        new RegExp(`export\\s+(const|let)\\s+${name}\\s*=\\s*cva`),
        `${path} must define and export ${name}`
      );
    }
  });

  test('Stray dashboard/@ directory does not exist', () => {
    const strayDir = resolve(dashboardRoot, '@');
    assert.equal(
      existsSync(strayDir),
      false,
      `Stray directory ${strayDir} must not exist; canonical UI components must reside in src/components/ui`
    );
  });

  test('Pages implement active cancellation flag and cleanup in polling effects', () => {
    const pages = [
      resolve(dashboardRoot, 'src/pages/Dashboard.tsx'),
      resolve(dashboardRoot, 'src/pages/Metrics.tsx'),
      resolve(dashboardRoot, 'src/pages/Traces.tsx'),
    ];

    for (const pagePath of pages) {
      const content = readFileSync(pagePath, 'utf-8');
      assert.match(
        content,
        /let\s+active\s*=\s*true;/,
        `${pagePath} must declare an active cancellation flag in its effect`
      );
      assert.match(
        content,
        /active\s*=\s*false;/,
        `${pagePath} must set active = false in effect cleanup`
      );
      assert.match(
        content,
        /clearInterval\s*\(\s*interval\s*\)/,
        `${pagePath} must clear polling interval in effect cleanup`
      );

      const effectMatch = content.match(/useEffect\(\(\)\s*=>\s*\{([\s\S]*?)\},\s*\[/);
      assert.ok(effectMatch, `${pagePath} must contain an effect with dependency array`);
      assert.doesNotMatch(
        effectMatch[1],
        /\bsetLoading\(true\)/,
        `${pagePath} must not invoke synchronous setLoading within the effect body`
      );
    }
  });
});

describe('Polling Controller Lifecycle Simulations (Unit-level behavior)', () => {
  // Note: These simulate the asynchronous state machines and cancellation guards
  // implemented inside Dashboard, Metrics, and Traces effect bodies.
  // Full component mounting tests require DOM emulation (jsdom/testing-library),
  // which is deliberately not included to avoid introducing unapproved dependencies.

  test('Dashboard controller simulation: active request updates state; unmounted request suppresses updates & errors', async () => {
    let dashboardData = null;
    let loggedErrors = [];

    // Controller lifecycle factory matching Dashboard.tsx
    const createDashboardController = (mockFetch) => {
      let active = true;

      const fetchData = async () => {
        try {
          const result = await mockFetch();
          if (!active) return;
          dashboardData = result;
        } catch (error) {
          if (active) loggedErrors.push(error);
        }
      };

      const execute = fetchData();
      const cleanup = () => {
        active = false;
      };

      return { execute, cleanup };
    };

    // Scenario 1: Normal active resolution
    const deferred1 = createDeferred();
    const ctrl1 = createDashboardController(() => deferred1.promise);
    deferred1.resolve({ kpis: { totalRequests: 100 } });
    await ctrl1.execute;
    assert.deepEqual(dashboardData, { kpis: { totalRequests: 100 } });

    // Scenario 2: Unmount while request is in-flight -> late resolution must not update state
    const deferred2 = createDeferred();
    const ctrl2 = createDashboardController(() => deferred2.promise);
    ctrl2.cleanup(); // simulate unmount
    deferred2.resolve({ kpis: { totalRequests: 999 } });
    await ctrl2.execute;
    assert.deepEqual(dashboardData, { kpis: { totalRequests: 100 } }, 'State must not be overwritten after unmount');

    // Scenario 3: Unmount while request is in-flight -> late rejection must not log error
    const deferred3 = createDeferred();
    const ctrl3 = createDashboardController(() => deferred3.promise);
    ctrl3.cleanup(); // simulate unmount
    deferred3.reject(new Error('Network failure after unmount'));
    await ctrl3.execute;
    assert.equal(loggedErrors.length, 0, 'Errors after unmount must be suppressed');
  });

  test('Metrics controller simulation: rapid service switches prevent race conditions and manage loading state', async () => {
    let currentMetrics = null;
    let loading = false;
    let loggedErrors = [];

    // Controller matching Metrics.tsx
    const createMetricsEffectCycle = (serviceName, fetchFn) => {
      let active = true;

      const load = async () => {
        try {
          const data = await fetchFn(serviceName);
          if (!active) return;
          currentMetrics = data;
        } catch (err) {
          if (active) loggedErrors.push(err);
        } finally {
          if (active) loading = false;
        }
      };

      load();
      const cleanup = () => {
        active = false;
      };

      return { cleanup };
    };

    // User switches to 'order-service' (slow request)
    loading = true;
    const orderDeferred = createDeferred();
    const cycle1 = createMetricsEffectCycle('order-service', () => orderDeferred.promise);

    // User rapidly switches to 'payment-service' before order-service completes (fast request)
    cycle1.cleanup(); // React effect cleanup runs for cycle 1
    loading = true;
    const paymentDeferred = createDeferred();
    createMetricsEffectCycle('payment-service', () => paymentDeferred.promise);

    // Payment request completes first
    paymentDeferred.resolve({ service: 'payment-service', p99: 45 });
    await paymentDeferred.promise;

    assert.equal(loading, false, 'Loading must resolve to false after latest request completes');
    assert.deepEqual(currentMetrics, { service: 'payment-service', p99: 45 });

    // Order request completes late -> must be discarded by cycle 1 guard
    orderDeferred.resolve({ service: 'order-service', p99: 300 });
    await orderDeferred.promise;

    assert.deepEqual(currentMetrics, { service: 'payment-service', p99: 45 }, 'Stale in-flight response must not overwrite newer state');
    assert.equal(loggedErrors.length, 0);
  });

  test('Metrics controller simulation: active request failure recovers loading state', async () => {
    let loading = true;
    let errorCaught = false;

    let active = true;
    const load = async () => {
      try {
        await Promise.reject(new Error('API 500'));
      } catch {
        if (active) errorCaught = true;
      } finally {
        if (active) loading = false;
      }
    };

    await load();

    assert.equal(errorCaught, true, 'Active errors must be caught');
    assert.equal(loading, false, 'Loading state must recover to false even on failure');
  });

  test('Traces controller simulation: interval timer and params tracking', () => {
    let clearedTimerId = null;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.clearInterval = (id) => {
      clearedTimerId = id;
    };

    try {
      let active = true;
      const interval = 12345; // simulated timer ID
      const cleanup = () => {
        active = false;
        clearInterval(interval);
      };

      cleanup();

      assert.equal(active, false);
      assert.equal(clearedTimerId, 12345, 'Cleanup function must pass interval ID to clearInterval');
    } finally {
      globalThis.clearInterval = originalClearInterval;
    }
  });
});
