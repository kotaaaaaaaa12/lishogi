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

export async function fetchWithRetry(request, namespace, id, {
  attempts = 3, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      // A stub that threw may remain broken. Obtain a fresh stub for each attempt.
      return await namespace.get(id, {locationHint: 'apac'}).fetch(request);
    } catch (error) {
      const safeMethod = request.method === 'GET' || request.method === 'HEAD';
      const transient = error.retryable === true
        || error.message?.includes('Durable Object reset because its code was updated');
      if (!safeMethod || !transient || error.overloaded === true || attempt + 1 >= attempts) throw error;
      await pause(100 * 2 ** attempt);
    }
  }
}
