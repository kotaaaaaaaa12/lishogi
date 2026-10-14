import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {publicRequest} from '../persistence.mjs';
import {waitForStartup, startupResponse} from '../readiness.mjs';

const source = await readFile(new URL('../worker.mjs', import.meta.url), 'utf8');
// Execute the Worker handlers with the Cloudflare-only Container dependency mocked.
const context = vm.createContext({
  Container: class {constructor(ctx, env) {this.ctx = ctx; this.env = env;}},
  ContainerProxy: class {}, publicRequest, waitForStartup, startupResponse,
  loadBackup() {}, publishBackup() {}, handleMail() {},
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
  await assert.rejects(server.fetch(request()), /R2 unavailable/);
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
    ready: false, stage: 'idle', release: 'standard2-startup-20261014-v2',
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
