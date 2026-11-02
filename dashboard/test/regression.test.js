import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dashboardRoot = resolve(__dirname, '..');

describe('Dashboard Lint Regression Tests', () => {
  test('ESLint passes with 0 errors and 0 warnings across all dashboard source files', async () => {
    const eslint = new ESLint({ cwd: dashboardRoot });
    const results = await eslint.lintFiles([
      'src/**/*.{ts,tsx}',
      '@/**/*.{ts,tsx}',
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
      resolve(dashboardRoot, '@/components/ui/badge.tsx'),
      resolve(dashboardRoot, '@/components/ui/button.tsx'),
      resolve(dashboardRoot, '@/components/ui/tabs.tsx'),
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
      { path: resolve(dashboardRoot, '@/components/ui/badge-variants.ts'), name: 'badgeVariants' },
      { path: resolve(dashboardRoot, '@/components/ui/button-variants.ts'), name: 'buttonVariants' },
      { path: resolve(dashboardRoot, '@/components/ui/tabs-variants.ts'), name: 'tabsListVariants' },
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

  test('Polling cancellation guard pattern suppresses state update after unmount', async () => {
    let state = 'initial';
    let active = true;

    const fetchOperation = async () => {
      await new Promise((r) => setTimeout(r, 20));
      if (!active) return;
      state = 'updated';
    };

    const promise = fetchOperation();

    active = false;
    await promise;

    assert.equal(state, 'initial', 'State should remain initial when effect cancelled before resolution');
  });

  test('Polling error handler suppresses uncaught errors when unmounted', async () => {
    let active = true;
    let errorLogged = false;

    const fetchOperation = async () => {
      try {
        await Promise.reject(new Error('Network error'));
      } catch {
        if (active) {
          errorLogged = true;
        }
      }
    };

    active = false;
    await fetchOperation();

    assert.equal(errorLogged, false, 'Error should not be logged if component unmounted');
  });
});
