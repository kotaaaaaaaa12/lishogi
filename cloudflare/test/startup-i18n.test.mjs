import assert from 'node:assert/strict';
import test from 'node:test';
import {startupLocale, startupMessages} from '../startup-i18n.mjs';
import {starting, startupPage} from '../startup-page.mjs';

test('language selection honors browser priority, regional tags and zero weights', () => {
  for (const [header, expected] of [
    ['ja', 'ja'], ['ja-JP, en-US;q=0.9, en;q=0.8', 'ja'],
    ['JA-jp;q=0.9, en;q=0.5', 'ja'], ['en;q=0.4,ja;q=0.9', 'ja'],
    ['en-US,ja;q=0.8', 'en'], ['fr-FR,ja;q=0.9', 'en'],
    ['en;q=0,ja;q=0.7', 'ja'], ['ja;q=0,en;q=0.5', 'en'],
    ['ja;q=invalid,en', 'en'], ['ja;q=2,en', 'en'],
    ['ja;q=-1,en', 'en'], ['javanese', 'en'], ['*', 'en'],
    ['', 'en'], [null, 'en'], [undefined, 'en'],
  ]) assert.equal(startupLocale(header), expected, String(header));
});

test('Japanese browser requests receive localized HTML before any script executes', async () => {
  const response = starting(new Request('https://shogi.test/game/123', {
    headers: {accept: 'text/html', 'accept-language': 'ja-JP, en;q=0.8'},
  }), 'database-restore', 'test-release');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-language'), 'ja');
  assert.match(response.headers.get('vary'), /Accept-Language/);
  const html = await response.text();
  const initialHtml = html.split('<script nonce=')[0];
  assert.match(initialHtml, /<html lang="ja">/);
  assert.match(initialHtml, /<title>将棋 · 起動中<\/title>/);
  for (const text of ['対局の準備中', '再試行', '詳細を表示', '起動の進行状況', '復元', '準備ができると自動で開きます', '自動更新にはJavaScriptが必要です。']) {
    assert.ok(initialHtml.includes(text), text);
  }
  assert.doesNotMatch(initialHtml, /Getting your board ready|Try again|Show details|Startup stages/);
  const nonce = html.match(/<script nonce="([a-f0-9]+)">/)[1];
  assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
});

test('unsupported and absent browser preferences receive English HTML', async () => {
  for (const language of ['en-US,ja;q=0.8', 'de-DE', '']) {
    const response = starting(new Request('https://shogi.test/', {
      headers: {accept: 'text/html', 'accept-language': language},
    }), 'idle', 'test-release');
    assert.equal(response.headers.get('content-language'), 'en');
    assert.match(await response.text(), /<html lang="en">/);
  }
  assert.match(startupPage('idle', '', '<script>'), /<html lang="en">/);
});

test('localized dictionaries have the same keys and all stage translations', () => {
  const en = startupMessages('en');
  const ja = startupMessages('ja');
  assert.deepEqual(Object.keys(ja).sort(), Object.keys(en).sort());
  assert.deepEqual(Object.keys(ja.stages).sort(), Object.keys(en.stages).sort());
  assert.equal(ja.steps.length, en.steps.length);
  for (const text of Object.values(ja.stages)) assert.match(text, /[\u3000-\u9fff]/);
});

test('Japanese preferences do not change API startup responses', async () => {
  const response = starting(new Request('https://shogi.test/', {
    method: 'POST', headers: {accept: 'text/html', 'accept-language': 'ja'},
  }), 'application-initialize', 'test-release');
  assert.equal(response.status, 503);
  assert.equal((await response.json()).stage, 'application-initialize');
});
