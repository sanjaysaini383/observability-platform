import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pkg from 'pg';

// Integration test: requires a disposable PostgreSQL database.
// The `products` table in it is dropped and recreated.
//   INVENTORY_TEST_DB_URL=postgresql://user:pass@localhost:5432/inventory_test npm test
const DB_URL = process.env.INVENTORY_TEST_DB_URL;
const PORT = process.env.INVENTORY_TEST_PORT || 5091;
const BASE_URL = `http://localhost:${PORT}`;
const ROUNDS = 20;
// More requests than pg.Pool's default max (10) so connections are shared between
// requests; with per-statement pool.query() this reliably oversold the last unit.
const CONCURRENT_REQUESTS = 20;

const { Pool } = pkg;
let pool;
let server;

before(async () => {
  if (!DB_URL) return;
  pool = new Pool({ connectionString: DB_URL });
  await pool.query('DROP TABLE IF EXISTS products');
  await pool.query(`
    CREATE TABLE products (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      price DECIMAL(10,2),
      stock INT
    )
  `);

  server = spawn(process.execPath, [fileURLToPath(new URL('./app.js', import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), INVENTORY_DB_URL: DB_URL, SERVICE_NAME: 'inventory-service-test' },
    stdio: 'ignore',
  });

  // Wait for the service to accept requests
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('inventory-service did not start');
});

after(async () => {
  server?.kill();
  await pool?.end();
});

test('concurrent reservations cannot oversell the last unit', { skip: !DB_URL && 'INVENTORY_TEST_DB_URL not set' }, async () => {
  let totalSuccesses = 0;

  for (let round = 0; round < ROUNDS; round++) {
    const { rows } = await pool.query(
      "INSERT INTO products (name, price, stock) VALUES ('Last Unit', 10.00, 1) RETURNING id"
    );
    const productId = rows[0].id;

    const responses = await Promise.all(
      Array.from({ length: CONCURRENT_REQUESTS }, () =>
        fetch(`${BASE_URL}/reserve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ productId, qty: 1 }] }),
        })
      )
    );
    const successes = responses.filter((res) => res.ok).length;
    totalSuccesses += successes;

    const { rows: [product] } = await pool.query('SELECT stock FROM products WHERE id = $1', [productId]);
    assert.ok(product.stock >= 0, `round ${round}: stock went negative (${product.stock})`);
    assert.ok(successes <= 1, `round ${round}: ${successes} reservations succeeded for 1 unit`);
    assert.equal(product.stock, 1 - successes, `round ${round}: stock does not match successful reservations`);
  }

  // Guard against a vacuous pass where every request failed (e.g. simulated errors only)
  assert.ok(totalSuccesses > 0, 'no reservation ever succeeded');
});
