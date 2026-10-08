const PREFIX = 'lishogi/v1/';
const MANIFEST = `${PREFIX}latest.json`;

export async function loadBackup(bucket) {
  const manifestObject = await bucket.get(MANIFEST);
  if (!manifestObject) return null;
  const manifest = await manifestObject.json();
  if (manifest.version !== 1 || !/^lishogi\/v1\/archives\/[a-zA-Z0-9.-]+\.gz$/.test(manifest.key)
      || !/^[a-f0-9]{64}$/.test(manifest.sha256) || !Number.isSafeInteger(manifest.size)
      || manifest.size <= 0) {
    throw new Error('Invalid backup manifest. Startup has been stopped.');
  }
  const archive = await bucket.get(manifest.key);
  if (!archive || archive.size !== manifest.size) {
    throw new Error('The committed backup is missing or incomplete. Startup has been stopped.');
  }
  if (archive.customMetadata?.sha256 !== manifest.sha256) {
    throw new Error('Backup metadata does not match the committed manifest.');
  }
  return { manifest, archive };
}

export async function publishBackup(bucket, response, now = Date.now()) {
  if (!response.ok) throw new Error(`Database backup failed: HTTP ${response.status}`);
  const size = Number(response.headers.get('content-length'));
  const sha256 = response.headers.get('x-backup-sha256');
  if (!response.body || !Number.isSafeInteger(size) || size <= 0 || !/^[a-f0-9]{64}$/.test(sha256 || '')) {
    throw new Error('Database backup response is incomplete.');
  }
  const key = `${PREFIX}archives/${now}-${crypto.randomUUID()}.gz`;
  const archive = await bucket.put(key, response.body, {
    httpMetadata: {contentType: 'application/gzip'},
    customMetadata: {sha256, createdAt: new Date(now).toISOString()},
  });
  if (!archive || archive.size !== size) throw new Error('R2 did not commit the complete database backup.');
  const manifest = {version: 1, key, size, sha256, createdAt: new Date(now).toISOString()};
  await bucket.put(MANIFEST, JSON.stringify(manifest), {
    httpMetadata: {contentType: 'application/json'},
  });
  return manifest;
}

export function publicRequest(request, origin) {
  const url = new URL(request.url);
  const canonical = new URL(origin);
  if (canonical.protocol !== 'https:' || canonical.username || canonical.password
      || canonical.pathname !== '/' || canonical.search || canonical.hash) {
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin.');
  }
  if (url.pathname.startsWith('/_cf/') || url.pathname === '/_cf') return null;
  const headers = new Headers(request.headers);
  headers.delete('x-container-control');
  headers.delete('x-forwarded-for');
  headers.delete('x-forwarded-host');
  headers.delete('x-real-ip');
  headers.set('x-forwarded-for', request.headers.get('cf-connecting-ip') || '127.0.0.1');
  headers.set('x-real-ip', request.headers.get('cf-connecting-ip') || '127.0.0.1');
  headers.set('x-forwarded-proto', 'https');
  headers.set('x-forwarded-host', canonical.host);
  headers.set('host', canonical.host);
  return new Request(request, {headers});
}
