// Cloudflare Turnstile server-side check.

export async function verifyTurnstile(opts: {
  secret: string;
  token: string;
  remoteIp?: string;
  expectedAction?: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const f = opts.fetchImpl ?? fetch;
  const form = new FormData();
  form.set('secret', opts.secret);
  form.set('response', opts.token);
  if (opts.remoteIp) form.set('remoteip', opts.remoteIp);
  try {
    const res = await f('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = (await res.json()) as { success?: boolean; action?: string };
    if (data.success !== true) return false;
    if (opts.expectedAction && data.action !== opts.expectedAction) return false;
    return true;
  } catch {
    return false;
  }
}
