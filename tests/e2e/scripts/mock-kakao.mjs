#!/usr/bin/env node
// Local stand-in for kauth.kakao.com + kapi.kakao.com, for E2E only (never used in production).
// The backend points at it via KAKAO_AUTH_BASE_URL / KAKAO_API_BASE_URL (see start-backend.sh).
//
//   GET  /oauth/authorize?client_id&redirect_uri&response_type=code&state
//        → 302 redirect_uri?code=<code>&state=<state>  (or ?error=access_denied&state=… when denied)
//   POST /oauth/token   (form: grant_type, client_id, redirect_uri, code[, client_secret]) → { access_token }
//   GET  /v2/user/me    (Bearer) → { id, kakao_account: { profile: { nickname } } }
//   POST /__mock/next   { id, nickname, deny?, fail? }  sets who "logs in" next (test control)
//   GET  /__mock/log    requests seen (for asserting that no secret leaks into URLs)
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_KAKAO_PORT ?? 4810);
const EXPECTED_CLIENT_ID = process.env.MOCK_KAKAO_CLIENT_ID ?? 'e2e-kakao-client';
const EXPECTED_SECRET = process.env.MOCK_KAKAO_CLIENT_SECRET ?? 'e2e-kakao-secret';

let next = { id: 9000000001, nickname: '카카오테스트', deny: false, fail: false };
const codes = new Map(); // code → identity
const tokens = new Map(); // access token → identity
const log = [];

const body = (req) =>
  new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
const json = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  log.push({ method: req.method, path: url.pathname, query: [...url.searchParams.keys()] });
  if (req.method === 'POST' && url.pathname === '/__mock/next') {
    next = { deny: false, fail: false, ...JSON.parse((await body(req)) || '{}') };
    return json(res, 200, next);
  }
  if (req.method === 'GET' && url.pathname === '/__mock/log') return json(res, 200, log);

  if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state') ?? '';
    if (url.searchParams.get('client_id') !== EXPECTED_CLIENT_ID || !redirect) return json(res, 400, { error: 'invalid_client' });
    const to = new URL(redirect);
    if (next.deny) {
      to.searchParams.set('error', 'access_denied');
      to.searchParams.set('error_description', 'User denied access');
    } else {
      const code = randomUUID();
      codes.set(code, { ...next });
      to.searchParams.set('code', code);
    }
    to.searchParams.set('state', state);
    res.writeHead(302, { Location: to.toString() });
    return res.end();
  }
  if (req.method === 'POST' && url.pathname === '/oauth/token') {
    const form = new URLSearchParams(await body(req));
    const who = codes.get(form.get('code') ?? '');
    if (form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== EXPECTED_CLIENT_ID || form.get('client_secret') !== EXPECTED_SECRET || !who)
      return json(res, 400, { error: 'invalid_grant' });
    codes.delete(form.get('code'));
    if (who.fail) return json(res, 500, { error: 'server_error' });
    const t = randomUUID();
    tokens.set(t, who);
    return json(res, 200, { token_type: 'bearer', access_token: t, expires_in: 21599 });
  }
  if (req.method === 'GET' && url.pathname === '/v2/user/me') {
    const who = tokens.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
    if (!who) return json(res, 401, { code: -401 });
    return json(res, 200, { id: who.id, kakao_account: { profile: { nickname: who.nickname } } });
  }
  json(res, 404, { error: 'not_found' });
}).listen(PORT, () => console.log(`mock kakao on :${PORT}`));
