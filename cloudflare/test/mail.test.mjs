import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleMail} from '../mail.mjs';
import {emailServiceDisabled} from '../auth-policy.mjs';

test('the retired mail bridge never sends even if an old binding remains', async () => {
  let called = false;
  const response = await handleMail(new Request('http://cf.mail/messages', {
    method: 'POST', body: new URLSearchParams({to: 'old@shogi.test'}),
  }), {EMAIL: {send: async () => {called = true;}}});
  assert.equal(response.status, 410);
  assert.equal(called, false);
});

test('email-dependent routes are disabled while password login and changes remain', () => {
  for (const path of ['/password/reset', '/password/reset/send', '/password/reset/confirm/token',
    '/auth/magic-link', '/auth/magic-link/login/token', '/signup/confirm/token',
    '/signup/check-your-email', '/signup/fix-email', '/account/email',
    '/account/email/confirm/token', '/api/account/email', '/account/reopen/send',
    '/contact/email-confirm/help']) assert.equal(emailServiceDisabled(path), true, path);
  for (const path of ['/signup', '/login', '/account/passwd', '/auth/token',
    '/account/twofactor', '/account/security', '/account/email-other'])
    assert.equal(emailServiceDisabled(path), false, path);
});
