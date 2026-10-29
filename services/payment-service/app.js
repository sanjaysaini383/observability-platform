import express from 'express';
import { trace } from '@opentelemetry/api';
import Razorpay from 'razorpay';
import { logError } from '../tracing.js';

const app = express();
const port = process.env.PORT || 3001;
const tracer = trace.getTracer('payment-service');

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_dummy',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
});

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'payment-service' }));

app.post('/pay', async (req, res) => {
    const span = tracer.startSpan('process_payment');
    try {
        const { orderId, amount } = req.body;

        // Simulate 10% timeout/failure rate for tracing
        if (Math.random() < 0.1) {
            throw new Error('Payment gateway timeout - simulated error');
        }

        span.addEvent('calling_razorpay');
        const options = {
            amount: Math.round(amount * 100), // amount in paise
            currency: 'USD',
            receipt: `receipt_${orderId}`
        };
        
        let transactionId = 'dummy_txn_id';
        // Only call Razorpay if real keys are provided, else simulate success
        if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_ID !== 'rzp_test_dummy') {
            const order = await razorpay.orders.create(options);
            transactionId = order.id;
        } else {
            // Simulated delay
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        span.setAttributes({ 'payment.order_id': orderId, 'razorpay.id': transactionId });
        span.setStatus({ code: 0 });
        span.end();
        res.json({ success: true, transactionId });
    } catch(err) {
        span.recordException(err);
        span.setStatus({ code: 2 });
        span.end();
        logError('Payment processing failed', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`🚀 Payment Service on http://localhost:${port}`));
