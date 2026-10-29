import express from 'express';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { logError } from '../tracing.js';

const app = express();
const port = process.env.PORT || 3000;

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:5000';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3001';
const INVENTORY_SERVICE_URL = process.env.INVENTORY_SERVICE_URL || 'http://inventory-service:5001';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:5002';

app.use(express.json());
app.use(cors());

// Optional JWT Middleware
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
        const token = authHeader.split(' ')[1];
        jwt.verify(token, 'secret_key', (err, user) => {
            if (err) { return res.sendStatus(403); }
            req.user = user;
            next();
        });
    } else {
        // Mock user for testing
        req.user = { email: 'customer@example.com', name: 'Test User' };
        next();
    }
};

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'api-gateway' });
});

app.get('/products', async (req, res) => {
    try {
        const response = await axios.get(`${INVENTORY_SERVICE_URL}/products`, {
            headers: { 'traceparent': req.headers['traceparent'] || '' }
        });
        res.json(response.data);
    } catch (err) {
        logError('Failed to fetch products', err);
        res.status(500).json({ error: err.message, service: 'api-gateway' });
    }
});

app.post('/checkout', authenticate, async (req, res) => {
    try {
        const { items } = req.body;
        const tp = req.headers['traceparent'] || '';

        // 1. Create order
        const orderRes = await axios.post(`${ORDER_SERVICE_URL}/orders`, {
            customer: req.user.name,
            email: req.user.email,
            items
        }, { headers: { 'traceparent': tp }});
        
        const { orderId, total } = orderRes.data;

        // 2. Process payment
        const paymentRes = await axios.post(`${PAYMENT_SERVICE_URL}/pay`, {
            orderId, amount: total
        }, { headers: { 'traceparent': tp }});

        // 3. Mark as paid
        await axios.put(`${ORDER_SERVICE_URL}/orders/${orderId}/pay`, {}, {
            headers: { 'traceparent': tp }
        });

        // 4. Send notification
        await axios.post(`${NOTIFICATION_SERVICE_URL}/send`, {
            email: req.user.email,
            orderId,
            status: 'paid'
        }, { headers: { 'traceparent': tp }});

        res.json({ success: true, orderId, transactionId: paymentRes.data.transactionId });
    } catch (err) {
        console.error('Checkout error:', err.message);
        logError('Checkout failed', err);
        res.status(err.response?.status || 500).json({ 
            error: err.message,
            service: 'api-gateway'
        });
    }
});

app.listen(port, () => {
    console.log(`🚀 API Gateway on http://localhost:${port}`);
    console.log(`📊 OTel Collector: ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4317'}`);
});
