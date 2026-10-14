export async function handleMail(request, env) {
  // Retain a harmless handler for any stale references to the old bridge.
  return new Response('Email sending is disabled.', {status: 410});
}
