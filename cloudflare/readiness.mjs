// Bound the HTTP wait without canceling database restore or backup publication.
export async function waitForStartup(startup, timeoutMilliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(startup).then(() => true),
      new Promise(resolve => {timer = setTimeout(() => resolve(false), timeoutMilliseconds);}),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function startupResponse(stage, release) {
  return Response.json({
    error: 'The server is starting or temporarily unavailable.', stage, release,
  }, {status: 503, headers: {'retry-after': '15', 'cache-control': 'no-store'}});
}
