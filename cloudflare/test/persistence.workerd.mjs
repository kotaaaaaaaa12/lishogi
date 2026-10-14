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
export default {async fetch(request, env) {
  const scenario = new URL(request.url).pathname.slice(1);
  try {
    if (scenario === 'raw-stream') {
      await env.BACKUPS.put('raw-stream-reproduction', backupResponse(7).body);
      return Response.json({ok: true});
    }
    if (scenario === 'upload') {
      const manifest = await publishBackup(env.BACKUPS, backupResponse(7), 100);
      const loaded = await loadBackup(env.BACKUPS);
      const bytes = new Uint8Array(await loaded.archive.arrayBuffer());
      return Response.json({manifest, size: bytes.length, bytes: [...bytes]});
    }
    const previous = (await loadBackup(env.BACKUPS))?.manifest;
    let failure;
    try {
      if (scenario === 'reject-upload') {
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
        await publishBackup(env.BACKUPS, backupResponse(scenario === 'short' ? 6 : 8), 200);
      }
    } catch (error) {failure = error.message;}
    const after = (await loadBackup(env.BACKUPS))?.manifest;
    return Response.json({error: failure, previous, after});
  } catch (error) {
    return Response.json({error: error.message}, {status: 500});
  }
}};
`;

async function verify(source) {
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: source + worker,
    compatibilityDate: '2026-10-08', r2Buckets: ['BACKUPS']}));
  try {
    const call = async scenario => {
      const response = await mf.dispatchFetch('https://test/' + scenario);
      return response.json();
    };
    const original = await call('raw-stream');
    assert.match(original.error, /known length/);
    console.log('Original R2 known-length failure reproduced in workerd.');
    const uploaded = await call('upload');
    assert.equal(uploaded.size, 7);
    assert.deepEqual(uploaded.bytes, Array(7).fill(65));
    console.log('Fixed stream uploaded to real local R2 binding and restored correctly.');
    for (const scenario of ['short', 'long']) {
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

await verify(await readFile(new URL('../persistence.mjs', import.meta.url), 'utf8'));
