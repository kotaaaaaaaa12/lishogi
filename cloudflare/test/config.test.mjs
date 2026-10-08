import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildConfiguration} from '../runtime/config.mjs';

const env = {
  PUBLIC_ORIGIN: 'https://shogi.test', MAIL_FROM: 'noreply@shogi.test',
  PLAY_SECRET: 'a'.repeat(64), USER_PASSWORD_SECRET: Buffer.alloc(32, 1).toString('base64'),
  SHOGINET_KEY: 'c'.repeat(64), CONTAINER_CONTROL_TOKEN: 'd'.repeat(64),
};

test('placeholder domains, insecure origins and missing secrets are rejected', () => {
  assert.throws(() => buildConfiguration({...env, PUBLIC_ORIGIN: 'http://shogi.test'}), /PUBLIC_ORIGIN/);
  assert.throws(() => buildConfiguration({...env, PUBLIC_ORIGIN: 'https://shogi.example.com'}), /PUBLIC_ORIGIN/);
  assert.throws(() => buildConfiguration({...env, PLAY_SECRET: 'short'}), /PLAY_SECRET/);
  assert.throws(() => buildConfiguration({...env, MAIL_FROM: 'noreply@example.com'}), /MAIL_FROM/);
});

test('password encryption requires a canonical Base64 AES key, not a hex token', () => {
  assert.throws(() => buildConfiguration({...env, USER_PASSWORD_SECRET: 'b'.repeat(64)}), /32-byte AES key/);
  assert.throws(() => buildConfiguration({...env, USER_PASSWORD_SECRET: Buffer.alloc(48).toString('base64')}), /32-byte AES key/);
  assert.doesNotThrow(() => buildConfiguration(env));
});


test('an origin cannot inject Nginx directives or redirect authentication to another path', () => {
  for (const origin of ['https://user:pass@shogi.test',
    'https://shogi.test/path', 'https://shogi.test?x=1', 'https://shogi.test#fragment',
    'https://shogi.test;', 'https://shogi.test:8443']) {
    assert.throws(() => buildConfiguration({...env, PUBLIC_ORIGIN: origin}), /PUBLIC_ORIGIN/);
  }
});
