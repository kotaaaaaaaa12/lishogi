import {startupResponse} from './readiness.mjs';

const labels = {
  idle: 'Preparing the server…',
  'container-port': 'Waking up the server…',
  'container-status': 'Checking the server…',
  'backup-load': 'Loading saved data…',
  'database-restore': 'Restoring saved data…',
  'application-initialize': 'Starting the game server…',
  'initial-backup': 'Saving the initial checkpoint…',
  'checkpoint-schedule': 'Finishing startup…',
  'idle-shutdown': 'Finishing a safe shutdown before restarting…',
  'request-failed': 'Reconnecting to the server…',
  stopped: 'Waking up the server again…',
  'container-error': 'Reconnecting to the server…',
  failed: 'The server could not start. Use Retry to try again.',
  'missing-secrets': 'Server configuration is incomplete. The site owner needs to finish setup.',
};

export function starting(request, stage, release) {
  const acceptsHtml = request.headers.get('accept')?.toLowerCase().includes('text/html');
  const websocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
  if (request.method !== 'GET' || !acceptsHtml || websocket) return startupResponse(stage, release);

  const nonce = crypto.randomUUID().replaceAll('-', '');
  const message = labels[stage] || 'Preparing the server…';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Starting Shogi</title>
<style>
html{color-scheme:dark light;font:16px system-ui;background:Canvas;color:CanvasText}
body{max-width:34rem;margin:18vh auto;padding:2rem}
h1{font-size:2rem;margin:1.4rem 0 1rem}
p{line-height:1.6;color:#666}
.spinner{width:2rem;height:2rem;border:3px solid #8885;border-top-color:currentColor;border-radius:50%;animation:spin 1s linear infinite}
button{font:inherit;color:inherit;background:transparent;border:1px solid #8888;border-radius:.4rem;padding:.65rem 1rem;cursor:pointer}
button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-color-scheme:dark){p{color:#b7b7b7}}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
@media(max-width:420px){body{margin:10vh auto;padding:1.5rem}}
</style>
</head>
<body>
<main>
<div class="spinner" aria-hidden="true"></div>
<h1>Starting Shogi</h1>
<p>The server is waking up and restoring its saved data. This page will reload when it is ready.</p>
<p id="status" role="status" aria-live="polite">${message}</p>
<button id="retry" type="button">Retry</button>
<noscript><p>JavaScript is disabled. Reload this page after the server has started.</p></noscript>
</main>
<script nonce="${nonce}">
const labels=${JSON.stringify(labels)};
const status=document.getElementById('status');
document.getElementById('retry').addEventListener('click',()=>location.reload());
async function check(){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch('/healthz',{cache:'no-store',credentials:'same-origin',signal:controller.signal});
    const state=await response.json();
    if(state.ready===true){location.reload();return;}
    status.textContent=labels[state.stage]||'Preparing the server…';
    if(state.stage==='failed'||state.stage==='missing-secrets'){
      document.querySelector('.spinner').hidden=true;
      return;
    }
    if(['idle','stopped','container-error','request-failed'].includes(state.stage)){
      setTimeout(()=>location.reload(),3000);
      return;
    }
  }catch{
    status.textContent='Connection interrupted. Retrying…';
  }finally{clearTimeout(timeout);}
  setTimeout(check,3000);
}
check();
</script>
</body>
</html>`;
  return new Response(html, {
    // Match the reference site's browser waiting page; APIs still receive 503 JSON.
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store', 'retry-after': '5', 'vary': 'Accept, Upgrade',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    },
  });
}
