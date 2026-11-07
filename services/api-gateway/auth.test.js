import { test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createAuthenticate } from './auth.js';

function run(authenticate, authorization) {
    const req = { headers: authorization === undefined ? {} : { authorization } };
    return new Promise((resolve) => {
        const res = { sendStatus: (code) => resolve({ status: code, req }) };
        authenticate(req, res, () => resolve({ status: 200, req }));
    });
}

const SECRET = 'test-secret-value';

test('no Authorization header falls back to the demo user', async () => {
    const { status, req } = await run(createAuthenticate(SECRET));
    assert.equal(status, 200);
    assert.equal(req.user.email, 'customer@example.com');
});

test('a token signed with JWT_SECRET is accepted', async () => {
    const token = jwt.sign({ email: 'a@b.c', name: 'A' }, SECRET);
    const { status, req } = await run(createAuthenticate(SECRET), `Bearer ${token}`);
    assert.equal(status, 200);
    assert.equal(req.user.email, 'a@b.c');
});

test('a token signed with any other secret is rejected, including the old literal', async () => {
    for (const other of ['secret_key', 'something-else']) {
        const token = jwt.sign({ email: 'x@y.z' }, other);
        const { status } = await run(createAuthenticate(SECRET), `Bearer ${token}`);
        assert.equal(status, 403);
    }
});

test('with no JWT_SECRET configured every bearer token is rejected', async () => {
    const token = jwt.sign({ email: 'x@y.z' }, 'secret_key');
    assert.equal((await run(createAuthenticate(''), `Bearer ${token}`)).status, 401);
    assert.equal((await run(createAuthenticate(undefined), `Bearer ${token}`)).status, 401);
});

test('malformed Authorization headers get 401', async () => {
    const authenticate = createAuthenticate(SECRET);
    for (const header of ['foo', 'Bearer', 'Basic abc', 'Bearer a b']) {
        assert.equal((await run(authenticate, header)).status, 401, header);
    }
});
