'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ChatGPT, consumeResponse, validateInput } = require('../core/chatgpt');
const { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } = require('jose');
function fixture(overrides = {}) {
  const vault = { value: {}, save() {} }; let opened;
  const ai = new ChatGPT({ vault, openExternal: async url => { opened = new URL(url); }, ...overrides });
  return { ai, vault, get opened() { return opened; } };
}
function profile(ai, extra = {}) {
  ai.data.profiles = [{ clientId: 'oaiapp_test', subject: 'person1', accessToken: 'access-test',
    refreshToken: 'refresh-test', scopes: ['chatgpt.tokens.use.direct'], expiresAt: Date.now() + 3600_000, ...extra }];
  ai.data.activeId = 'oaiapp_test';
}
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
function stream(events) {
  return new Response(new ReadableStream({
    start(controller) {
      const bytes = Buffer.from(events.map(e => 'data: ' + JSON.stringify(e) + '\r\n\r\n').join(''));
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.subarray(i, i + 3));
      controller.close();
    }
  }));
}
test('OAuth uses PKCE, rejects wrong state, validates identity, and stores a distinct account', async () => {
  let exchanged;
  const f = fixture({
    fetchImpl: async (url, options) => {
      exchanged = new URLSearchParams(options.body);
      return json({ id_token: 'signed-id', access_token: 'secret-access', refresh_token: 'secret-refresh', scope: 'openid chatgpt.tokens.use.direct', expires_in: 3600 });
    },
    verifyIdentity: async (token, clientId, nonce) => {
      assert.equal(token, 'signed-id'); assert.equal(clientId, 'oaiapp_new');
      assert.equal(nonce, f.opened.searchParams.get('nonce')); return { sub: 'user1', email: 'test@example.com' };
    }
  });
  try {
    await f.ai.signIn();
    assert.equal(f.opened.origin, 'https://auth.openai.com');
    assert.equal(f.opened.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(f.opened.searchParams.get('agent_name_hint'), 'GhostBar');
    const callback = new URL(f.opened.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: 'wrong', code: 'unused', client_id: 'oaiapp_new' });
    assert.equal((await fetch(callback)).status, 400);
    assert.ok(f.ai.pending);
    callback.searchParams.set('state', f.opened.searchParams.get('state'));
    assert.equal((await fetch(callback)).status, 200);
    assert.equal(exchanged.get('client_id'), 'oaiapp_new');
    assert.equal(exchanged.get('resource'), 'https://api.openai.com/v1');
    assert.equal(crypto.createHash('sha256').update(exchanged.get('code_verifier')).digest('base64url'), f.opened.searchParams.get('code_challenge'));
    assert.equal(f.ai.status().connected, true);
    assert.equal(f.ai.pending, null);
    assert.ok(!JSON.stringify(f.ai.status()).includes('secret-access'));
  } finally { f.ai.cancelSignIn(); }
});
test('returning account rejects a different issued client ID without changing credentials', async () => {
  const f = fixture({ fetchImpl: () => { throw new Error('must not exchange'); } }); profile(f.ai);
  try {
    await f.ai.signIn('oaiapp_test');
    assert.equal(f.opened.searchParams.has('agent_name_hint'), false);
    const callback = new URL(f.opened.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: f.opened.searchParams.get('state'), code: 'code', client_id: 'other' });
    assert.equal((await fetch(callback)).status, 400);
    assert.equal(f.ai.profile.accessToken, 'access-test');
  } finally { f.ai.cancelSignIn(); }
});
test('ID tokens require a valid signature, audience and nonce', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const f = fixture(); f.ai.discoveryInfo = { issuer: 'https://auth.openai.com' };
  f.ai.jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test' }] });
  const signed = await new SignJWT({ sub: 'person1', nonce: 'nonce' }).setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer('https://auth.openai.com').setAudience('client').setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.equal((await f.ai.verify(signed, 'client', 'nonce')).sub, 'person1');
  await assert.rejects(f.ai.verify(signed, 'other', 'nonce'));
  await assert.rejects(f.ai.verify(signed, 'client', 'wrong'));
  await assert.rejects(f.ai.verify(signed.slice(0, -8) + 'tampered', 'client', 'nonce'));
});
test('concurrent refreshes rotate credentials once and preserve the issued client', async () => {
  let calls = 0;
  const f = fixture({ fetchImpl: async (url, options) => {
    calls++; const body = new URLSearchParams(options.body);
    assert.equal(body.get('client_id'), 'oaiapp_test'); assert.equal(body.has('scope'), false);
    await new Promise(r => setTimeout(r, 10));
    return json({ access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600 });
  } });
  profile(f.ai, { expiresAt: 0 });
  assert.deepEqual(await Promise.all([f.ai.token(), f.ai.token(), f.ai.token()]), ['new-access', 'new-access', 'new-access']);
  assert.equal(calls, 1); assert.equal(f.ai.profile.refreshToken, 'rotated');
});
test('stream success requires completion and rejects failures after text', async () => {
  const delta = { type: 'response.output_text.delta', delta: 'Hello ✦' };
  assert.equal(await consumeResponse(stream([delta, { type: 'response.completed' }])), 'Hello ✦');
  await assert.rejects(consumeResponse(stream([delta])), /before OpenAI completed/);
  await assert.rejects(consumeResponse(stream([delta, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])), /plan limit/);
  await assert.rejects(consumeResponse(stream([{ type: 'response.incomplete' }])), /interrupted/);
});
test('inference uses the account catalog, public endpoint and required plan fields', async () => {
  const f = fixture({ fetchImpl: async (url, options) => {
    if (url.endsWith('/models')) return json({ models: [{ slug: 'permitted', display_name: 'Allowed', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }] });
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.model, 'permitted');
    assert.equal('max_output_tokens' in body, false);
    assert.equal(options.headers.Authorization, 'Bearer access-test');
    return stream([{ type: 'response.output_text.delta', delta: 'OK' }, { type: 'response.completed' }]);
  } });
  profile(f.ai);
  assert.equal(await f.ai.chat([{ role: 'user', content: 'Hi' }]), 'OK');
  await assert.rejects(f.ai.chat([{ role: 'user', content: 'Hi' }], 'hidden'), /available/);
});
test('invalid histories and remote image URLs cannot reach the provider', () => {
  assert.throws(() => validateInput([{ role: 'system', content: 'Bad' }]));
  assert.throws(() => validateInput([{ role: 'user', content: [{ type: 'input_image', image_url: 'http://localhost/private' }] }]));
  assert.throws(() => validateInput([]));
});
test('sign-out clears secrets if revocation fails and retains the client identity', async () => {
  const f = fixture({ fetchImpl: async () => { throw new Error('offline'); } }); profile(f.ai);
  const result = await f.ai.signOut();
  assert.match(result.message, /not confirmed/);
  assert.equal(f.ai.profile.clientId, 'oaiapp_test'); assert.equal(f.ai.profile.subject, 'person1');
  assert.equal(f.ai.profile.accessToken, undefined); assert.equal(f.ai.profile.refreshToken, undefined);
});
