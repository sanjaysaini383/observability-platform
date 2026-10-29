import express from 'express';
import { trace } from '@opentelemetry/api';
import pkg from 'pg';
import { logError } from '../tracing.js';

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 5001;
const tracer = trace.getTracer('inventory-service');

const DB_URL = process.env.INVENTORY_DB_URL || 'postgresql://default:password@postgres:5432/inventory';

const pool = new Pool({ connectionString: DB_URL });

app.use(express.json());

// Initialize table and seed data
app.post('/init', async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                price DECIMAL(10,2),
                stock INT
            )
        `);
        // Seed if empty
        const count = await pool.query('SELECT COUNT(*) FROM products');
        if (parseInt(count.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO products (name, price, stock) VALUES 
                ('Mechanical Keyboard', 149.99, 50),
                ('Wireless Mouse', 59.99, 100),
                ('Monitor 4K', 399.99, 20),
                ('USB-C Hub', 45.00, 200)
            `);
        }
        res.json({ message: 'Inventory initialized' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'inventory-service' }));

// Fetch products
app.get('/products', async (req, res) => {
    const span = tracer.startSpan('get_products');
    try {
        const result = await pool.query('SELECT * FROM products');
        span.setStatus({ code: 0 });
        span.end();
        res.json(result.rows);
    } catch (err) {
        span.recordException(err);
        span.setStatus({ code: 2 });
        span.end();
        logError('Failed to fetch products', err);
        res.status(500).json({ error: err.message });
    }
});

// Reserve stock and calculate total
app.post('/reserve', async (req, res) => {
    const span = tracer.startSpan('reserve_stock');
    try {
        const { items } = req.body;
        let total = 0;

        // Simulate 10% failure rate for tracing
        if (Math.random() < 0.1) {
            throw new Error('Inventory database timeout - simulated error');
        }

        // Simple transaction (for demo purposes)
        await pool.query('BEGIN');
        for (const item of items) {
            const { rows } = await pool.query('SELECT price, stock FROM products WHERE id = $1 FOR UPDATE', [item.productId]);
            if (rows.length === 0) throw new Error(`Product ${item.productId} not found`);
            if (rows[0].stock < item.qty) throw new Error(`Insufficient stock for product ${item.productId}`);
            
            total += parseFloat(rows[0].price) * item.qty;
            await pool.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.qty, item.productId]);
        }
        await pool.query('COMMIT');

        span.setAttributes({ 'inventory.items_count': items.length, 'inventory.total': total });
        span.setStatus({ code: 0 });
        span.end();
        res.json({ success: true, total });
    } catch (err) {
        await pool.query('ROLLBACK');
        span.recordException(err);
        span.setStatus({ code: 2 });
        span.end();
        logError('Stock reservation failed', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`🚀 Inventory Service on http://localhost:${port}`));
