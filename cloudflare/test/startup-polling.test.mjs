import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {startupPage} from '../startup-page.mjs';

async function poll(status, state, locale = 'en') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {textContent: '', hidden: true, addEventListener() {}});
    return elements.get(id);
  };
  const steps = [0, 1, 2].map(index => ({
    dataset: {step: String(index)}, classes: new Set(),
    classList: {toggle(name, enabled) {
      if (enabled) steps[index].classes.add(name);
      else steps[index].classes.delete(name);
    }},
    setAttribute() {}, removeAttribute() {},
  }));
  const document = {
    body: {dataset: {}}, hidden: false,
    getElementById: element, querySelectorAll: () => steps, addEventListener() {},
  };
  const timers = new Map();
  let sequence = 0;
  let reloads = 0;
  const sandbox = {
    document, AbortController,
    fetch: async () => Response.json(state, {status}),
    location: {reload() {reloads++;}},
    setTimeout(callback, delay) {const id = ++sequence; timers.set(id, {callback, delay}); return id;},
    clearTimeout(id) {timers.delete(id);}, setInterval() {},
  };
  const script = startupPage('idle', '', locale).match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, sandbox);
  await new Promise(resolve => setImmediate(resolve));
  return {element, document, steps, timers, reloads: () => reloads};
}

test('503 startup health renders progress and schedules the next check', async () => {
  const view = await poll(503, {ready: false, stage: 'application-initialize'});
  assert.equal(view.element('status').textContent, 'Setting up your board…');
  assert.equal(view.document.body.dataset.state, 'loading');
  assert.equal(view.steps[2].classes.has('active'), true);
  assert.equal([...view.timers.values()].some(timer => timer.delay === 3000), true);
  assert.equal(view.reloads(), 0);
});

test('503 configuration failures render the error state and Retry button', async () => {
  const view = await poll(503, {ready: false, stage: 'missing-secrets'});
  assert.equal(view.document.body.dataset.state, 'error');
  assert.equal(view.element('retry').hidden, false);
  assert.equal(view.element('status').textContent, 'Unable to start the server.');
});

test('503 stopped health schedules a delayed restart instead of leaving the page stuck', async () => {
  const view = await poll(503, {ready: false, stage: 'stopped'});
  const restart = [...view.timers.values()].find(timer => timer.delay === 5000);
  assert.ok(restart);
  restart.callback();
  assert.equal(view.reloads(), 1);
});

test('successful ready health reloads the original location', async () => {
  const view = await poll(200, {ready: true, stage: 'ready'});
  assert.equal(view.reloads(), 1);
  assert.equal(view.steps.every(step => step.classes.has('done')), true);
});

test('other HTTP failures keep the connection retry message', async () => {
  const view = await poll(502, {ready: false, stage: 'application-initialize'});
  assert.equal(view.element('status').textContent, 'Reconnecting to the server…');
  assert.equal([...view.timers.values()].some(timer => timer.delay === 3000), true);
  assert.equal(view.reloads(), 0);
});

test('Japanese progress stays localized after a 503 health response', async () => {
  const view = await poll(503, {ready: false, stage: 'application-initialize'}, 'ja');
  assert.equal(view.element('status').textContent, '対局の準備をしています…');
  assert.equal(view.element('heading').textContent, '対局の準備中');
  assert.equal(view.element('auto-label').textContent, '準備ができると自動で開きます');
  assert.equal(view.steps[2].classes.has('active'), true);
  assert.equal(view.reloads(), 0);
});

test('Japanese failures keep diagnostics as text and localize the error UI', async () => {
  const view = await poll(503, {ready: false, stage: 'failed', error: '<private diagnostic>'}, 'ja');
  assert.equal(view.document.body.dataset.state, 'error');
  assert.equal(view.element('heading').textContent, '起動できませんでした');
  assert.equal(view.element('status').textContent, 'サーバーを起動できませんでした。');
  assert.equal(view.element('badge').textContent, '起動を中断しました');
  assert.equal(view.element('retry').hidden, false);
  assert.equal(view.element('error').textContent, '<private diagnostic>');
});

test('Japanese network failures remain localized and continue polling', async () => {
  const view = await poll(502, {}, 'ja');
  assert.equal(view.element('status').textContent, 'サーバーに再接続しています…');
  assert.equal(view.element('auto-label').textContent, '自動で再確認します');
  assert.ok([...view.timers.values()].some(timer => timer.delay === 3000));
});

test('Japanese ready and stopped states preserve reload behavior', async () => {
  const ready = await poll(200, {ready: true}, 'ja');
  assert.equal(ready.element('status').textContent, '対局の準備ができました。');
  assert.equal(ready.reloads(), 1);
  const stopped = await poll(503, {ready: false, stage: 'stopped'}, 'ja');
  [...stopped.timers.values()].find(timer => timer.delay === 5000).callback();
  assert.equal(stopped.reloads(), 1);
});

