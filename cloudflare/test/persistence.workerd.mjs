import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'miniflare';
const {Miniflare, convertV4MiniflareOptions} = await import(modulePath);
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const worker = `
function backupResponse(length, declared = 7) {
  const body = new ReadableStream({start(controller) {
    controller.enqueue(new Uint8Array(length).fill(65));
    controller.close();
  }});
  return new Response(body, {headers: {
    'content-length': String(declared), 'x-backup-sha256': 'b'.repeat(64),
  }});
}
function proxyBackupResponse(length = 7, declared = 7, tee = false) {
  const stream = new IdentityTransformStream();
  const writer = stream.writable.getWriter();
  void (async () => {
    await writer.write(new Uint8Array(length).fill(65));
    await writer.close();
  })().catch(() => {});
  let readable = stream.readable;
  if (tee) {
    const branches = readable.tee();
    readable = branches[0];
    void branches[1].cancel().catch(() => {});
  }
  return new Response(readable, {headers: {
    'content-length': String(declared), 'x-backup-sha256': 'b'.repeat(64),
  }});
}
export class BackupVerifier extends DurableObject {
 async fetch(request) {
  const env = this.env;
  const scenario = new URL(request.url).pathname.slice(1);
  try {
    if (scenario === 'raw-stream') {
      await env.BACKUPS.put('raw-stream-reproduction', backupResponse(7).body);
      return Response.json({ok: true});
    }
    if (scenario === 'upload' || scenario === 'proxy-upload' || scenario === 'tee-upload') {
      const manifest = await publishBackup(env.BACKUPS,
        scenario === 'upload' ? backupResponse(7) : proxyBackupResponse(7, 7, scenario === 'tee-upload'), 100);
      const loaded = await loadBackup(env.BACKUPS);
      const bytes = new Uint8Array(await loaded.archive.arrayBuffer());
      return Response.json({manifest, size: bytes.length, bytes: [...bytes]});
    }
    const previous = (await loadBackup(env.BACKUPS))?.manifest;
    let failure;
    try {
      if (scenario === 'reject-native') {
        await publishBackup({put() {throw new Error('R2 unavailable');}}, proxyBackupResponse(), 200);
      } else if (scenario === 'reject-upload') {
        let canceled = false;
        const body = new ReadableStream({
          pull(controller) {controller.enqueue(new Uint8Array(1));},
          cancel() {canceled = true;},
        });
        const bucket = {put() {throw new Error('R2 unavailable');}};
        try {
          await publishBackup(bucket, new Response(body, {headers: {
            'content-length': '7', 'x-backup-sha256': 'b'.repeat(64),
          }}), 200);
        } catch (error) {
          return Response.json({error: error.message, canceled});
        }
      } else {
        const length = scenario.includes('short') ? 6 : 8;
        await publishBackup(env.BACKUPS,
          scenario.startsWith('native-') ? proxyBackupResponse(length) : backupResponse(length), 200);
      }
    } catch (error) {failure = error.message;}
    const after = (await loadBackup(env.BACKUPS))?.manifest;
    return Response.json({error: failure, previous, after});
  } catch (error) {
    return Response.json({error: error.message}, {status: 500});
  }
}}
export default {fetch(request, env) {
  return env.VERIFIER.get(env.VERIFIER.idFromName("test")).fetch(request);
}};
`;

async function verify(source) {
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: 'import {DurableObject} from "cloudflare:workers";\n' + source + worker,
    compatibilityDate: '2026-10-08', r2Buckets: ['BACKUPS'], durableObjects: {VERIFIER: {className: 'BackupVerifier', useSQLite: true}}}));
  try {
    const call = async scenario => {
      let timer;
      try {
        return await Promise.race([
          mf.dispatchFetch('https://test/' + scenario).then(response => response.json()),
          new Promise((resolve, reject) => {timer = setTimeout(() => reject(new Error(scenario + ' timed out')), 5000);}),
        ]);
      } finally {clearTimeout(timer);}
    };
    const original = await call('raw-stream');
    assert.match(original.error, /known length/);
    console.log('Original R2 known-length failure reproduced in workerd.');
    const uploaded = await call('upload');
    assert.equal(uploaded.size, 7);
    assert.deepEqual(uploaded.bytes, Array(7).fill(65));
    console.log('Fixed stream uploaded to real local R2 binding and restored correctly.');
    for (const scenario of ['proxy-upload', 'tee-upload']) {
      const proxy = await call(scenario);
      assert.equal(proxy.size, 7, JSON.stringify(proxy));
      assert.deepEqual(proxy.bytes, Array(7).fill(65));
      console.log(scenario + ': native IdentityTransformStream uploaded and restored correctly.');
    }
    for (const scenario of ['short', 'long', 'native-short', 'native-long', 'reject-native']) {
      const result = await call(scenario);
      assert.ok(result.error, scenario + ' stream must fail');
      assert.deepEqual(result.after, result.previous);
      console.log(scenario + ' stream rejected; previous backup preserved.');
    }
    const rejection = await call('reject-upload');
    assert.equal(rejection.error, 'R2 unavailable');
    assert.equal(rejection.canceled, true);
    console.log('Immediate upload failure canceled the source stream without hanging.');
  } finally {await mf.dispose();}
}

const sourcePath = process.argv[3] ? resolve(process.argv[3]) : new URL('../persistence.mjs', import.meta.url);
await verify(await readFile(sourcePath, 'utf8'));
