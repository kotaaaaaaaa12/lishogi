import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {publicRequest} from '../persistence.mjs';
import {waitForStartup, startupResponse, fetchWithRetry} from '../readiness.mjs';
import {emailServiceDisabled, emailDisabledResponse} from '../auth-policy.mjs';
import {starting} from '../startup-page.mjs';

const source = await readFile(new URL('../worker.mjs', import.meta.url), 'utf8');
// Execute the Worker handlers with the Cloudflare-only Container dependency mocked.
const context = vm.createContext({
  Container: class {
    constructor(ctx, env) {this.ctx = ctx; this.env = env; this.container = {running: true, monitor: async () => {}};}
    renewActivityTimeout() {}
    deleteSchedules() {}
  },
  ContainerProxy: class {}, publicRequest, waitForStartup, startupResponse, fetchWithRetry,
  loadBackup() {}, publishBackup() {}, emailServiceDisabled, emailDisabledResponse, starting,
  Request, Response, Headers, URL, console: {info() {}, error() {}},
});
new vm.Script(source.replace(/^import .*;\n/gm, '')
  .replace('export {ContainerProxy};', '')
  .replace('export class LishogiServer', 'class LishogiServer')
  .replace('export default {', 'const worker = {')
  + '\nglobalThis.handlers = {LishogiServer, worker};').runInContext(context);

function fixture() {
  const background = [];
  const server = new context.handlers.LishogiServer({waitUntil(promise) {background.push(promise);}}, {
    PUBLIC_ORIGIN: 'https://shogi.what-the-fuck.men',
    CONTAINER_CONTROL_TOKEN: 'test', PLAY_SECRET: 'test',
    USER_PASSWORD_SECRET: 'test', SHOGINET_KEY: 'test',
  });
  server.startupWaitMilliseconds = 5;
  return {server, background};
}
const request = () => new Request('https://shogi.what-the-fuck.men/');

test('a stalled startup returns 503 while one shared background startup continues', async () => {
  const {server, background} = fixture();
  let finish;
  let starts = 0;
  let forwarded = 0;
  server.boot = async () => {
    starts++;
    server.stage('initial-backup');
    await new Promise(resolve => {finish = resolve;});
    server.applicationReady = true;
    server.stage('ready');
  };
  server.containerFetch = async () => {forwarded++; return new Response('Board');};
  const [first, second] = await Promise.all([server.fetch(request()), server.fetch(request())]);
  assert.equal(first.status, 503);
  assert.equal(second.status, 503);
  assert.equal((await first.json()).stage, 'initial-backup');
  assert.equal(starts, 1);
  assert.equal(background.length, 1);
  assert.equal(forwarded, 0);
  finish();
  await Promise.all(background);
  assert.equal(await (await server.fetch(request())).text(), 'Board');
  assert.equal(starts, 1);
});

test('startup errors are reported and a later request can retry', async () => {
  const {server, background} = fixture();
  let starts = 0;
  server.boot = async () => {if (++starts === 1) throw new Error('R2 unavailable');};
  server.containerFetch = async () => new Response('Board');
  const failure = await server.fetch(request());
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).stage, 'failed');
  await Promise.all(background);
  assert.equal(server.startupStage, 'failed');
  assert.equal(await (await server.fetch(request())).text(), 'Board');
  assert.equal(starts, 2);
});

test('health reports startup state without starting or exposing secrets', async () => {
  const {server} = fixture();
  server.boot = () => {throw new Error('Health must not start the application');};
  const response = await server.fetch(new Request('https://shogi.what-the-fuck.men/healthz'));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ready: false, stage: 'idle', release: 'standard2-startup-screen-20261015-v5',
  });
  server.applicationReady = true;
  server.stage('ready');
  assert.equal((await server.fetch(new Request('https://shogi.what-the-fuck.men/healthz'))).status, 200);
});

test('private control paths never start the application', async () => {
  const {server, background} = fixture();
  assert.equal((await server.fetch(new Request('https://shogi.what-the-fuck.men/_cf/status'))).status, 404);
  assert.equal(background.length, 0);
});

test('the outer Worker returns a versioned 503 for binding errors', async () => {
  const response = await context.handlers.worker.fetch(request(), {
    PUBLIC_ORIGIN: 'https://shogi.what-the-fuck.men',
    LISHOGI: {idFromName: () => 'id', get: () => ({fetch: async () => {throw new Error('Connection lost');}})},
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).stage, 'request-failed');
});

test('email URLs return 410 without starting or contacting the container', async () => {
  const {server, background} = fixture();
  server.ensureReady = () => {throw new Error('Mail routes must not start the application');};
  const req = new Request('https://shogi.what-the-fuck.men/password/reset/send', {method: 'POST'});
  assert.equal((await server.fetch(req)).status, 410);
  assert.equal(background.length, 0);
  assert.equal((await context.handlers.worker.fetch(req, {
    PUBLIC_ORIGIN: 'https://shogi.what-the-fuck.men',
    LISHOGI: {idFromName: () => {throw new Error('Mail routes must not contact the binding');}},
  })).status, 410);
});

test('background checkpoints neither restart stopped containers nor renew activity', async () => {
  const {server} = fixture();
  let backups = 0;
  let armed = 0;
  server.applicationReady = true;
  server.saveBackup = async () => {backups++;};
  server.armCheckpoint = async () => {armed++;};
  server.renewActivityTimeout = () => {throw new Error('Checkpoint must not renew public activity');};
  server.ensureReady = () => {throw new Error('Checkpoint must not start the container');};
  await server.checkpoint();
  assert.equal(backups, 1);
  assert.equal(armed, 1);
  server.container.running = false;
  await server.checkpoint();
  assert.equal(backups, 1);
  assert.equal(armed, 1);
  assert.equal(server.sleepAfter, '10m');
});

test('control requests use the direct port and cannot renew the SDK activity timer', async () => {
  const {server} = fixture();
  server.containerFetch = () => {throw new Error('Control must not use the public proxy');};
  server.container.getTcpPort = port => ({fetch: async request => {
    assert.equal(port, 8080);
    assert.equal(new URL(request.url).pathname, '/_cf/backup');
    assert.equal(request.headers.get('x-container-control'), 'test');
    return new Response('archive');
  }});
  assert.equal(await (await server.control('backup', {method: 'POST'})).text(), 'archive');
});

test('idle shutdown stops only after the final backup succeeds', async () => {
  const {server} = fixture();
  const events = [];
  server.ensureReady = async () => {events.push('ready');};
  server.saveBackup = async () => {events.push('backup');};
  server.deleteSchedules = () => {events.push('unschedule');};
  server.stop = async () => {events.push('stop'); server.container.running = false; await server.onStop();};
  await server.onActivityExpired();
  assert.deepEqual(events, ['ready', 'backup', 'unschedule', 'stop', 'unschedule']);
  assert.equal(server.shutdownPromise, undefined);
  assert.equal(server.applicationReady, false);
  assert.equal(server.startupStage, 'stopped');
});

test('failed final backup leaves the container running and rearms checkpoints', async () => {
  const {server} = fixture();
  let armed = false;
  server.ensureReady = async () => {};
  server.saveBackup = async () => {throw new Error('R2 unavailable');};
  server.stop = () => {throw new Error('Must not stop after failed backup');};
  server.armCheckpoint = async () => {armed = true;};
  await assert.rejects(server.onActivityExpired(), /R2 unavailable/);
  assert.equal(server.container.running, true);
  assert.equal(armed, true);
  assert.equal(server.shutdownPromise, undefined);
});

test('a request arriving during shutdown waits before startup and forwarding', async () => {
  const {server} = fixture();
  const events = [];
  let finish;
  server.shutdownPromise = new Promise(resolve => {finish = resolve;});
  server.ensureReady = async () => {events.push('startup');};
  server.containerFetch = async () => {events.push('forward'); return new Response('Board');};
  const waiting = await server.fetch(request());
  assert.equal(waiting.status, 503);
  assert.equal((await waiting.json()).stage, 'idle-shutdown');
  assert.deepEqual(events, []);
  finish();
  await server.shutdownPromise;
  assert.equal(await (await server.fetch(request())).text(), 'Board');
  assert.deepEqual(events, ['startup', 'forward']);
});

test('a transient GET error retries a fresh stub with bounded backoff', async () => {
  let stubs = 0;
  const delays = [];
  const namespace = {get() {
    const current = ++stubs;
    return {fetch: async () => {
      if (current < 3) throw Object.assign(new Error('Transient reset'), {retryable: true});
      return new Response('Board');
    }};
  }};
  const result = await fetchWithRetry(request(), namespace, 'id', {pause: async ms => {delays.push(ms);}});
  assert.equal(await result.text(), 'Board');
  assert.equal(stubs, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('POST, overloads and ordinary application errors are never retried', async () => {
  for (const [method, properties] of [['POST', {retryable: true}], ['GET', {retryable: true, overloaded: true}], ['GET', {}]]) {
    let attempts = 0;
    const namespace = {get: () => ({fetch: async () => {
      attempts++;
      throw Object.assign(new Error('Failure'), properties);
    }})};
    await assert.rejects(fetchWithRetry(new Request(request().url, {method}), namespace, 'id'), /Failure/);
    assert.equal(attempts, 1);
  }
});

test('browser startup waits return HTML and continue one shared boot in the background', async () => {
  const {server, background} = fixture();
  let finish;
  server.boot = async () => {
    server.stage('application-initialize');
    await new Promise(resolve => {finish = resolve;});
  };
  const result = await server.fetch(new Request(request().url, {headers: {accept: 'text/html'}}));
  assert.equal(result.status, 200);
  assert.match(await result.text(), /Starting Shogi/);
  assert.equal(background.length, 1);
  finish();
  await Promise.all(background);
});

test('outer Worker binding failures also show a browser waiting screen', async () => {
  const result = await context.handlers.worker.fetch(new Request(request().url, {
    headers: {accept: 'text/html'},
  }), {
    PUBLIC_ORIGIN: 'https://shogi.what-the-fuck.men',
    LISHOGI: {idFromName: () => 'id', get: () => ({fetch: async () => {throw new Error('Private infrastructure detail');}})},
  });
  assert.equal(result.status, 200);
  const html = await result.text();
  assert.match(html, /Starting Shogi/);
  assert.doesNotMatch(html, /Private infrastructure detail/);
});

test('health cannot report ready after the container has exited', async () => {
  const {server} = fixture();
  server.applicationReady = true;
  server.stage('ready');
  server.container.running = false;
  const result = await server.fetch(new Request('https://shogi.what-the-fuck.men/healthz'));
  assert.equal(result.status, 503);
  assert.equal((await result.json()).ready, false);
  assert.equal(server.startupStage, 'stopped');
});

test('upstream connection failure clears readiness before the waiting page polls health', async () => {
  const {server} = fixture();
  server.applicationReady = true;
  server.bootPromise = Promise.resolve();
  server.stage('ready');
  server.ensureReady = async () => {};
  server.containerFetch = async () => {throw new Error('Connection lost');};
  const result = await server.fetch(new Request(request().url, {headers: {accept: 'text/html'}}));
  assert.match(await result.text(), /Starting Shogi/);
  assert.equal(server.bootPromise, undefined);
  const health = await server.fetch(new Request('https://shogi.what-the-fuck.men/healthz'));
  assert.equal(health.status, 503);
  const state = await health.json();
  assert.equal(state.ready, false);
  assert.equal(state.stage, 'request-failed');
});
