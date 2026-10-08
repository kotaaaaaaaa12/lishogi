import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadBackup, publishBackup, publicRequest} from '../persistence.mjs';

const sha = 'b'.repeat(64);
function memoryBucket() {
  const values = new Map();
  return {
    values, failArchive: false, failManifest: false,
    async get(key) {return values.get(key) || null;},
    async put(key, value, options) {
      if (this.failArchive && key.includes('/archives/')) throw new Error('R2 unavailable');
      if (this.failManifest && key.endsWith('latest.json')) throw new Error('Manifest write failed');
      let bytes;
      if (typeof value === 'string') bytes = new TextEncoder().encode(value);
      else bytes = new Uint8Array(await new Response(value).arrayBuffer());
      const obj = {
        size: bytes.length, body: new Blob([bytes]).stream(), customMetadata: options?.customMetadata,
        json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      };
      values.set(key, obj);
      return obj;
    },
  };
}
function response() {
  return new Response('archive', {headers: {
    'content-length': '7', 'x-backup-sha256': sha,
  }});
}

test('an empty bucket is distinguishable from a corrupt committed backup', async () => {
  const bucket = memoryBucket();
  assert.equal(await loadBackup(bucket), null);
  await bucket.put('lishogi/v1/latest.json', '{"version":1}');
  await assert.rejects(loadBackup(bucket), /Invalid backup manifest/);
});

test('a committed backup can be restored with its archive metadata', async () => {
  const bucket = memoryBucket();
  const manifest = await publishBackup(bucket, response(), 100);
  const saved = await loadBackup(bucket);
  assert.deepEqual(saved.manifest, manifest);
  assert.equal(saved.archive.size, 7);
});

test('a failed archive upload leaves the previous committed backup intact', async () => {
  const bucket = memoryBucket();
  const previous = await publishBackup(bucket, response(), 100);
  bucket.failArchive = true;
  await assert.rejects(publishBackup(bucket, response(), 200), /R2 unavailable/);
  assert.deepEqual((await loadBackup(bucket)).manifest, previous);
});

test('a failed manifest publication leaves the previous backup selected', async () => {
  const bucket = memoryBucket();
  const previous = await publishBackup(bucket, response(), 100);
  bucket.failManifest = true;
  await assert.rejects(publishBackup(bucket, response(), 200), /Manifest write failed/);
  assert.deepEqual((await loadBackup(bucket)).manifest, previous);
});

test('a missing committed archive fails closed instead of returning an empty database', async () => {
  const bucket = memoryBucket();
  const saved = await publishBackup(bucket, response(), 100);
  bucket.values.delete(saved.key);
  await assert.rejects(loadBackup(bucket), /missing or incomplete/);
});

test('a checksum metadata mismatch stops restore', async () => {
  const bucket = memoryBucket();
  const saved = await publishBackup(bucket, response(), 100);
  bucket.values.get(saved.key).customMetadata.sha256 = 'c'.repeat(64);
  await assert.rejects(loadBackup(bucket), /metadata does not match/);
});

test('incomplete backup responses cannot replace a committed backup', async () => {
  const bucket = memoryBucket();
  const previous = await publishBackup(bucket, response(), 100);
  await assert.rejects(publishBackup(bucket, new Response('partial'), 200), /incomplete/);
  assert.deepEqual((await loadBackup(bucket)).manifest, previous);
});

test('untrusted forwarding headers and control credentials do not reach the application', () => {
  const request = new Request('https://shogi.test/play/abcd1234/v1', {headers: {
    'x-container-control': 'fake', 'x-forwarded-for': 'attacker', 'x-real-ip': 'attacker',
    'x-forwarded-host': 'attacker.test', 'cf-connecting-ip': '192.0.2.1',
    origin: 'https://shogi.test', upgrade: 'websocket', cookie: 'lila2=session',
  }});
  const forwarded = publicRequest(request, 'https://shogi.test');
  assert.equal(forwarded.headers.get('x-container-control'), null);
  assert.equal(forwarded.headers.get('x-forwarded-for'), '192.0.2.1');
  assert.equal(forwarded.headers.get('x-real-ip'), '192.0.2.1');
  assert.equal(forwarded.headers.get('host'), 'shogi.test');
  assert.equal(forwarded.headers.get('x-forwarded-proto'), 'https');
  assert.equal(forwarded.headers.get('cookie'), 'lila2=session');
  assert.equal(forwarded.headers.get('upgrade'), 'websocket');
  assert.equal(forwarded.headers.get('origin'), 'https://shogi.test');
});

test('public requests cannot reach container control endpoints', () => {
  assert.equal(publicRequest(new Request('https://shogi.test/_cf/restore'), 'https://shogi.test'), null);
});
