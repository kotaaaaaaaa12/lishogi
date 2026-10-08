import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {mkdir, rm, stat} from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash, timingSafeEqual} from 'node:crypto';
import {writeConfiguration, buildConfiguration} from './config.mjs';

const children = new Set();
let ready = false;
let stopping = false;
let operation = Promise.resolve();
const mongoUri = 'mongodb://localhost:27017/?replicaSet=rs0';
const backupPath = '/run/lishogi/backup.archive.gz';
const restorePath = '/run/lishogi/restore.archive.gz';
const maxArchiveSize = 1024 * 1024 * 1024;

function log(message) {console.log(`[cloudflare] ${message}`);}
function authenticated(request) {
  const actual = Buffer.from(request.headers['x-container-control'] || '');
  const expected = Buffer.from(process.env.CONTAINER_CONTROL_TOKEN || '');
  return expected.length >= 32 && actual.length === expected.length && timingSafeEqual(actual, expected);
}
function serial(task) {
  const result = operation.then(task);
  operation = result.catch(() => {});
  return result;
}
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'inherit', 'inherit'], ...options});
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with ${code ?? signal}`));
    });
  });
}
function start(command, args, options = {}) {
  const child = spawn(command, args, {stdio: ['ignore', 'inherit', 'inherit'], ...options});
  children.add(child);
  child.on('error', error => {log(`${command} failed: ${error.code}`); shutdown(1);});
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {log(`${command} stopped: ${code ?? signal}`); shutdown(1);}
  });
  return child;
}
async function waitPort(port, timeout = 180_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const found = await new Promise(resolve => {
      const socket = net.connect({host: '127.0.0.1', port});
      socket.setTimeout(1000);
      socket.on('connect', () => {socket.destroy(); resolve(true);});
      socket.on('error', () => {socket.destroy(); resolve(false);});
      socket.on('timeout', () => {socket.destroy(); resolve(false);});
    });
    if (found) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Service on port ${port} did not become ready.`);
}
async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function bootDatabases() {
  await mkdir('/data/mongo', {recursive: true});
  await mkdir('/data/redis', {recursive: true});
  await mkdir('/run/lishogi', {recursive: true});
  start('mongod', [
    '--dbpath', '/data/mongo', '--bind_ip', '127.0.0.1', '--replSet', 'rs0',
    '--wiredTigerCacheSizeGB', '1', '--oplogSize', '512', '--quiet',
  ]);
  start('redis-server', [
    '--bind', '127.0.0.1', '--protected-mode', 'yes', '--dir', '/data/redis',
    '--appendonly', 'no', '--save', '', '--maxmemory', '512mb', '--maxmemory-policy', 'noeviction',
  ]);
  await waitPort(27017);
  await waitPort(6379);
  await run('mongosh', ['--quiet', 'mongodb://127.0.0.1:27017/admin', '--eval', `
    try { rs.status(); }
    catch (error) {
      if (error.code !== 94) throw error;
      rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]});
    }
    for (let i = 0; i < 120 && !db.hello().isWritablePrimary; i++) sleep(500);
    if (!db.hello().isWritablePrimary) throw new Error('MongoDB did not elect a primary.');
  `]);
}

async function initialize() {
  if (ready) return;
  await writeConfiguration(process.env);
  await run('mongosh', ['--quiet', mongoUri, '--eval', `
    const lishogi = db.getSiblingDB('lishogi');
    lishogi.fishnet_client.updateOne({_id: process.env.SHOGINET_KEY}, {
      $set: {userId: 'lishogi', skill: 'all', enabled: true},
      $setOnInsert: {createdAt: new Date()}
    }, {upsert: true});
    lishogi.user4.createIndex({username: 1});
    lishogi.user4.createIndex({email: 1});
    lishogi.game5.createIndex({'p.uid': 1, ca: -1});
  `]);
  start('/opt/lishogi/app/bin/lila', [
    '-Dconfig.file=/run/lishogi/application.conf', '-J-Xms256m', '-J-Xmx3g',
  ], {cwd: '/opt/lishogi/app'});
  start('/opt/lila-ws/bin/lila-ws', [
    '-Dconfig.file=/run/lishogi/socket.conf', '-J-Xms64m', '-J-Xmx512m',
  ], {cwd: '/opt/lila-ws'});
  await waitPort(9663);
  await waitPort(9664);
  const response = await fetch('http://127.0.0.1:9663/', {
    headers: {host: new URL(process.env.PUBLIC_ORIGIN).host}, redirect: 'manual',
  });
  await response.body?.cancel();
  if (response.status >= 500) throw new Error(`Lishogi startup returned HTTP ${response.status}.`);
  start('nginx', ['-c', '/run/lishogi/nginx.conf']);
  await waitPort(8082);
  start(process.execPath, ['--import', 'tsx', 'src/main.ts'], {cwd: '/opt/shoginet'});
  ready = true;
  log('Application services are ready.');
}

async function backup(response) {
  if (!ready) throw new Error('Cannot back up an uninitialized application.');
  await run('mongodump', ['--uri', mongoUri, `--archive=${backupPath}`, '--gzip', '--oplog', '--quiet']);
  const info = await stat(backupPath);
  if (!info.size || info.size > maxArchiveSize) throw new Error('Backup archive exceeds the supported size.');
  const digest = await hashFile(backupPath);
  response.writeHead(200, {
    'content-type': 'application/gzip', 'content-length': info.size,
    'x-backup-sha256': digest, 'cache-control': 'no-store',
  });
  try {await pipeline(createReadStream(backupPath), response);}
  finally {await rm(backupPath, {force: true});}
}

async function restore(request) {
  if (ready) throw new Error('Cannot restore over a running application.');
  const expected = request.headers['x-backup-sha256'];
  if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('A restore requires the committed SHA-256 checksum.');
  }
  let size = 0;
  const hash = createHash('sha256');
  const check = new Transform({transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > maxArchiveSize) return callback(new Error('Restore archive is too large.'));
    hash.update(chunk);
    callback(null, chunk);
  }});
  try {
    await pipeline(request, check, createWriteStream(restorePath, {mode: 0o600}));
    if (!size || hash.digest('hex') !== expected) throw new Error('Restore archive checksum does not match.');
    await run('mongorestore', [
      '--uri', mongoUri, `--archive=${restorePath}`, '--gzip', '--oplogReplay', '--drop', '--stopOnError', '--quiet',
    ]);
  } finally {await rm(restorePath, {force: true});}
}

function proxy(request, response) {
  if (!ready) {
    response.writeHead(503, {'retry-after': '15', 'content-type': 'text/plain'});
    return response.end('The application is starting.');
  }
  const headers = {...request.headers};
  delete headers['x-container-control'];
  const upstream = http.request({
    hostname: '127.0.0.1', port: 8082, method: request.method, path: request.url, headers,
  }, incoming => {
    response.writeHead(incoming.statusCode, incoming.headers);
    incoming.pipe(response);
    incoming.on('error', () => response.destroy());
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, {'content-type': 'text/plain'});
    response.end('The application service is unavailable.');
  });
  request.on('aborted', () => upstream.destroy());
  response.on('close', () => {if (!response.writableEnded) upstream.destroy();});
  request.pipe(upstream);
}

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, 'http://container').pathname;
  if (!path.startsWith('/_cf/')) return proxy(request, response);
  if (!authenticated(request)) {response.writeHead(404); return response.end();}
  if (path === '/_cf/status' && request.method === 'GET') {
    response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
    return response.end(JSON.stringify({ready}));
  }
  if (request.method !== 'POST') {response.writeHead(405); return response.end();}
  try {
    await serial(async () => {
      if (path === '/_cf/backup') return backup(response);
      if (path === '/_cf/restore') await restore(request);
      else if (path === '/_cf/initialize') await initialize();
      else {response.writeHead(404); return response.end();}
      response.writeHead(200, {'content-type': 'application/json'});
      response.end(JSON.stringify({ok: true}));
    });
  } catch (error) {
    log(`Control operation failed: ${error.message}`);
    if (!response.headersSent) response.writeHead(500, {'content-type': 'text/plain'});
    response.end('The operation failed. Check the container logs.');
  }
});

server.on('upgrade', (request, socket, head) => {
  if (!ready || new URL(request.url, 'http://container').pathname.startsWith('/_cf')) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return;
  }
  const headers = {...request.headers};
  delete headers['x-container-control'];
  const upstream = http.request({hostname: '127.0.0.1', port: 8082, path: request.url, headers});
  upstream.on('upgrade', (incoming, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}`];
    for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
      lines.push(`${incoming.rawHeaders[i]}: ${incoming.rawHeaders[i + 1]}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    socket.pipe(upstreamSocket).pipe(socket);
    socket.on('error', () => upstreamSocket.destroy());
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('close', () => upstreamSocket.destroy());
    upstreamSocket.on('close', () => socket.destroy());
  });
  upstream.on('response', incoming => {
    socket.end(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\nConnection: close\r\n\r\n`);
    incoming.resume();
  });
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.end();
});

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  ready = false;
  server.close();
  const existing = [...children];
  for (const child of existing) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
    process.exit(code);
  }, 30_000);
  Promise.all(existing.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once('exit', resolve);
  }))).then(() => {clearTimeout(force); process.exit(code);});
}

process.on('SIGTERM', () => shutdown());
process.on('SIGINT', () => shutdown());
try {
  buildConfiguration(process.env);
  await bootDatabases();
  server.listen(8080, '0.0.0.0', () => log('Control service is ready for database restoration.'));
} catch (error) {
  log(`Startup failed: ${error.message}`);
  shutdown(1);
}
