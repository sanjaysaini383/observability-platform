import express from 'express';
import { trace } from '@opentelemetry/api';
import pkg from 'pg';
import axios from 'axios';
import { logError } from '../tracing.js';

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 5000;
const tracer = trace.getTracer('order-service');

const DB_URL = process.env.ORDER_DB_URL || 'postgresql://default:password@postgres:5432/orders';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:5001';

const pool = new Pool({ connectionString: DB_URL });

app.use(express.json());

// Initialize table
app.post('/init', async (req, res) => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                customer VARCHAR(255),
                email VARCHAR(255),
                total DECIMAL(10,2),
                status VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        res.json({ message: 'Orders initialized' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'order-service' }));

app.post('/orders', async (req, res) => {
    const span = tracer.startSpan('create_order');
    try {
        const { customer, email, items } = req.body;
        
        span.addEvent('calling_inventory_reserve');
        const invRes = await axios.post(`${INVENTORY_SERVICE_URL}/reserve`, { items }, {
            headers: { 'traceparent': req.headers['traceparent'] || '' }
        });
        
        const total = invRes.data.total;
        
        span.addEvent('inserting_order_db');
        const result = await pool.query(
            'INSERT INTO orders (customer, email, total, status) VALUES ($1, $2, $3, $4) RETURNING id',
            [customer, email, total, 'pending']
        );
        
        const orderId = result.rows[0].id;
        span.setAttributes({ 'order.id': orderId, 'order.total': total });
        
        span.setStatus({ code: 0 });
        span.end();
        res.json({ orderId, total, status: 'pending' });
    } catch (err) {
        span.recordException(err);
        span.setStatus({ code: 2 });
        span.end();
        logError('Order creation failed', err);
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

app.put('/orders/:id/pay', async (req, res) => {
    const span = tracer.startSpan('update_order_status');
    try {
        const { id } = req.params;
        await pool.query("UPDATE orders SET status = 'paid' WHERE id = $1", [id]);
        span.setStatus({ code: 0 });
        span.end();
        res.json({ success: true, orderId: id, status: 'paid' });
    } catch (err) {
        span.recordException(err);
        span.setStatus({ code: 2 });
        span.end();
        logError('Order status update failed', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`🚀 Order Service on http://localhost:${port}`));
