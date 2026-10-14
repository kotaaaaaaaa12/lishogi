const disabledPaths = /^\/(?:password\/reset|auth\/magic-link|account\/(?:email|reopen)|api\/account\/email|signup\/(?:check-your-email|fix-email|confirm)|contact\/email-confirm\/help)(?:\/|$)/;

export function emailServiceDisabled(pathname) {
  return disabledPaths.test(pathname);
}

export function emailDisabledResponse() {
  return new Response('Email-based account services are disabled. Sign in with your username and password.', {
    status: 410, headers: {'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store'},
  });
}
