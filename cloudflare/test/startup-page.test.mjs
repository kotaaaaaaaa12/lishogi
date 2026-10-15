import assert from 'node:assert/strict';
import test from 'node:test';
import {starting} from '../startup-page.mjs';

test('browser navigation receives the Shogi waiting screen with a matching CSP nonce', async () => {
  const response = starting(new Request('https://shogi.test/game/123?color=white', {
    headers: {accept: 'text/html,application/xhtml+xml'},
  }), 'database-restore', 'test-release');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /text\/html/);
  const html = await response.text();
  assert.match(html, /<h1>Starting Shogi<\/h1>/);
  assert.match(html, /Restoring saved data…/);
  assert.match(html, /fetch\('\/healthz'/);
  const nonce = html.match(/<script nonce="([a-f0-9]+)">/)[1];
  assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
});

test('API, POST, HEAD and WebSocket requests keep the JSON 503 response', async () => {
  for (const init of [
    {}, {headers: {accept: 'application/json'}},
    {method: 'POST', headers: {accept: 'text/html'}},
    {method: 'HEAD', headers: {accept: 'text/html'}},
    {headers: {accept: 'text/html', upgrade: 'websocket'}},
  ]) {
    const response = starting(new Request('https://shogi.test/', init), 'initial-backup', 'test-release');
    assert.equal(response.status, 503);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal((await response.json()).stage, 'initial-backup');
  }
});

test('unknown startup values cannot inject HTML into the screen', async () => {
  const html = await starting(new Request('https://shogi.test/', {
    headers: {accept: 'text/html'},
  }), '<img src=x onerror=alert(1)>', '<script>private diagnostic</script>').text();
  assert.doesNotMatch(html, /<img|private diagnostic/);
});
