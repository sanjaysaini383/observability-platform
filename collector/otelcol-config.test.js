import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

describe('OTel Collector Configuration & Deployment Integrity', () => {
  const configPath = resolve(repoRoot, 'collector/otelcol-config.yaml');
  const composePath = resolve(repoRoot, 'infra/docker-compose.yml');
  const readmePath = resolve(repoRoot, 'README.md');

  const configContent = readFileSync(configPath, 'utf-8');
  const composeContent = readFileSync(composePath, 'utf-8');
  const readmeContent = readFileSync(readmePath, 'utf-8');

  test('Deprecated logging exporter is completely removed from exporter definitions', () => {
    assert.doesNotMatch(
      configContent,
      /^\s*logging:\s*$/m,
      'otelcol-config.yaml must not define the deprecated logging exporter'
    );
    assert.doesNotMatch(
      configContent,
      /loglevel:\s*warn/,
      'otelcol-config.yaml must not use the legacy loglevel setting'
    );
  });

  test('Canonical debug exporter is declared with basic verbosity', () => {
    assert.match(
      configContent,
      /debug:\s*\r?\n\s+verbosity:\s*basic/,
      'otelcol-config.yaml must define debug exporter with verbosity: basic'
    );
  });

  test('Pipelines use the debug exporter instead of logging exporter', () => {
    assert.doesNotMatch(
      configContent,
      /exporters:\s*\[[^\]]*\blogging\b[^\]]*\]/,
      'No pipeline in service.pipelines should reference the deprecated logging exporter'
    );

    const tracesMatch = configContent.match(/traces:\s*\r?\n\s+receivers:[^\r\n]*\r?\n\s+processors:[^\r\n]*\r?\n\s+exporters:\s*\[([^\]]+)\]/);
    assert.ok(tracesMatch, 'Traces pipeline must be declared');
    assert.match(tracesMatch[1], /\bdebug\b/, 'Traces pipeline must include debug exporter');
    assert.match(tracesMatch[1], /\bkafka\/traces\b/, 'Traces pipeline must include kafka/traces exporter');

    const metricsMatch = configContent.match(/metrics:\s*\r?\n\s+receivers:[^\r\n]*\r?\n\s+processors:[^\r\n]*\r?\n\s+exporters:\s*\[([^\]]+)\]/);
    assert.ok(metricsMatch, 'Metrics pipeline must be declared');
    assert.match(metricsMatch[1], /\bdebug\b/, 'Metrics pipeline must include debug exporter');
    assert.match(metricsMatch[1], /\bkafka\/metrics\b/, 'Metrics pipeline must include kafka/metrics exporter');

    const logsMatch = configContent.match(/logs:\s*\r?\n\s+receivers:[^\r\n]*\r?\n\s+processors:[^\r\n]*\r?\n\s+exporters:\s*\[([^\]]+)\]/);
    assert.ok(logsMatch, 'Logs pipeline must be declared');
    assert.match(logsMatch[1], /\bdebug\b/, 'Logs pipeline must include debug exporter');
    assert.match(logsMatch[1], /\bkafka\/logs\b/, 'Logs pipeline must include kafka/logs exporter');
  });

  test('Kafka exporter preserves otlp_json encoding and retry policies', () => {
    const kafkaTopics = ['otel.traces', 'otel.metrics', 'otel.logs'];
    for (const topic of kafkaTopics) {
      assert.match(
        configContent,
        new RegExp(`topic:\\s*${topic}`),
        `Kafka exporter must configure topic ${topic}`
      );
    }

    const encodingMatches = configContent.match(/encoding:\s*otlp_json/g);
    assert.equal(
      encodingMatches?.length,
      3,
      'All three kafka exporters must specify encoding: otlp_json'
    );

    const retryMatches = configContent.match(/retry_on_failure:\s*\r?\n\s+enabled:\s*true/g);
    assert.equal(
      retryMatches?.length,
      3,
      'All three kafka exporters must have retry_on_failure enabled'
    );
  });

  test('Receivers bind to all interfaces on standard OTLP ports', () => {
    assert.match(configContent, /endpoint:\s*0\.0\.0\.0:4317/, 'OTLP gRPC receiver must bind to 0.0.0.0:4317');
    assert.match(configContent, /endpoint:\s*0\.0\.0\.0:4318/, 'OTLP HTTP receiver must bind to 0.0.0.0:4318');
  });

  test('infra/docker-compose.yml pins otel-collector to updated image version', () => {
    assert.match(
      composeContent,
      /image:\s*otel\/opentelemetry-collector-contrib:0\.104\.0/,
      'infra/docker-compose.yml must pin otel-collector to version 0.104.0'
    );
    assert.doesNotMatch(
      composeContent,
      /0\.92\.0/,
      'infra/docker-compose.yml must no longer reference 0.92.0'
    );
  });

  test('README.md architecture table matches pinned collector release', () => {
    assert.match(
      readmeContent,
      /OTel Collector Contrib `0\.104\.0`/,
      'README.md must document the updated collector version 0.104.0'
    );
    assert.doesNotMatch(
      readmeContent,
      /OTel Collector Contrib `0\.92\.0`/,
      'README.md must not reference old 0.92.0 release'
    );
  });
});
