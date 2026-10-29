import express from 'express';
import { trace } from '@opentelemetry/api';
import nodemailer from 'nodemailer';
import { logError } from '../tracing.js';

const app = express();
const port = process.env.PORT || 5002;
const tracer = trace.getTracer('notification-service');

// SMTP configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.SMTP_USER || 'dummy@gmail.com',
        pass: process.env.SMTP_PASS || 'dummy'
    }
});

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'notification-service' }));

app.post('/send', async (req, res) => {
    const span = tracer.startSpan('send_email');
    try {
        const { email, orderId, status } = req.body;
        
        // Simulate 10% error rate for tracing
        if (Math.random() < 0.1) {
            throw new Error('SMTP server timeout - simulated error');
        }

        const mailOptions = {
            from: process.env.SMTP_USER || 'dummy@gmail.com',
            to: email,
            subject: `Order ${orderId} Confirmation`,
            text: `Your order ${orderId} is now ${status}. Thank you for shopping with us!`
        };

        span.addEvent('sending_email_via_smtp');
        
        // Only actually send if credentials exist
        if (process.env.SMTP_PASS && process.env.SMTP_PASS !== 'dummy') {
            await transporter.sendMail(mailOptions);
        } else {
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        span.setStatus({ code: 0 });
        span.end();
        res.json({ success: true });
    } catch(err) {
        span.recordException(err);
        span.setStatus({ code: 2 });
        span.end();
        logError('Notification send failed', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(port, () => console.log(`🚀 Notification Service on http://localhost:${port}`));
