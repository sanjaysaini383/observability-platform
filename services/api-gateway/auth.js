import jwt from 'jsonwebtoken';

/**
 * Optional JWT middleware.
 *
 * - No Authorization header: demo mode, a mock user is attached.
 * - Header present: the bearer token must verify against `secret`
 *   (JWT_SECRET). If no secret is configured, every bearer token is rejected
 *   rather than checked against a default.
 * - Malformed header (not "Bearer <token>"): 401.
 */
export function createAuthenticate(secret = process.env.JWT_SECRET) {
    return (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            // Mock user for testing
            req.user = { email: 'customer@example.com', name: 'Test User' };
            return next();
        }

        const [scheme, token, ...rest] = authHeader.trim().split(/\s+/);
        if (!/^bearer$/i.test(scheme) || !token || rest.length) {
            return res.sendStatus(401);
        }
        if (!secret) {
            return res.sendStatus(401);
        }

        jwt.verify(token, secret, { algorithms: ['HS256'] }, (err, user) => {
            if (err) { return res.sendStatus(403); }
            req.user = user;
            next();
        });
    };
}
