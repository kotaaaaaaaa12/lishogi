export async function handleMail(request, env) {
  if (new URL(request.url).pathname !== '/messages' || request.method !== 'POST') {
    return new Response('Not found', {status: 404});
  }
  if (!env.CONTAINER_CONTROL_TOKEN || request.headers.get('authorization') !==
      `Basic ${btoa(`api:${env.CONTAINER_CONTROL_TOKEN}`)}`) {
    return new Response('Unauthorized', {status: 401});
  }
  const form = await request.formData();
  const to = form.get('to');
  const subject = form.get('subject');
  const text = form.get('text');
  const html = form.get('html');
  if (typeof to !== 'string' || typeof subject !== 'string' || typeof text !== 'string'
      || !to.includes('@') || /[\r\n,;]/.test(to) || /[\r\n]/.test(subject)
      || (html !== null && typeof html !== 'string')) {
    return new Response('Invalid email request', {status: 400});
  }
  if (!env.EMAIL) return new Response('Cloudflare Email Sending is not configured.', {status: 503});
  try {
    const result = await env.EMAIL.send({
      from: env.MAIL_FROM, to, subject, text, ...(html ? {html} : {}),
    });
    return Response.json({id: result.messageId, message: 'Queued'});
  } catch (error) {
    console.error('Email delivery failed:', error.code || 'unknown');
    return new Response('Email delivery failed', {status: 502});
  }
}
