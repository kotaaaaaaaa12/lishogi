import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleMail} from '../mail.mjs';

const secret = 'a'.repeat(64);
const payload = {to: 'recipient@shogi.test', subject: 'Confirm your account', text: 'Open this link.', html: '<p>Open this link.</p>'};
function request(data = payload, authorized = true) {
  return new Request('http://cf.mail/messages', {method: 'POST',
    headers: authorized ? {authorization: `Basic ${btoa(`api:${secret}`)}`} : {},
    body: new URLSearchParams(data),
  });
}
test('the Mailgun-compatible bridge sends through Cloudflare using the configured sender', async () => {
  let sent;
  const env = {CONTAINER_CONTROL_TOKEN: secret, MAIL_FROM: 'noreply@shogi.test',
    EMAIL: {send: async message => {sent = message; return {messageId: 'id-123'};}}};
  const response = await handleMail(request(), env);
  assert.equal(response.status, 200);
  assert.deepEqual(sent, {from: 'noreply@shogi.test', ...payload});
});
test('unauthorized requests do not send emails', async () => {
  let called = false;
  const response = await handleMail(request(payload, false), {CONTAINER_CONTROL_TOKEN: secret,
    EMAIL: {send: async () => {called = true;}}});
  assert.equal(response.status, 401);
  assert.equal(called, false);
});
test('email header injection is rejected', async () => {
  const response = await handleMail(request({...payload, to: 'a@b.test\r\nBcc: other@b.test'}),
    {CONTAINER_CONTROL_TOKEN: secret});
  assert.equal(response.status, 400);
});
test('email delivery failures propagate to the upstream retry mechanism', async () => {
  const response = await handleMail(request(), {CONTAINER_CONTROL_TOKEN: secret,
    EMAIL: {send: async () => {throw Object.assign(new Error('Unavailable'), {code: 'E_DELIVERY_FAILED'});}}});
  assert.equal(response.status, 502);
});
