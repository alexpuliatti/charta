import { setTimeout as delay } from 'node:timers/promises';

const API = 'https://api.are.na';

/** Credentials stay in process memory and are sent only to the pinned API origin. */
export class ArenaClient {
  constructor(token, { fetch: fetcher = globalThis.fetch, pause = delay, interval = 260, log = () => {} } = {}) {
    if (typeof token !== 'string' || !token.trim()) throw new Error('An Are.na access token is required.');
    this.token = token.trim(); this.fetcher = fetcher; this.pause = pause; this.interval = interval; this.log = log; this.lastRequest = 0;
  }

  async get(resource) {
    const url = new URL(resource, API);
    if (url.origin !== API || url.username || url.password || !url.pathname.startsWith('/v3/')) throw new Error('Are.na requests must use the documented API origin.');
    for (let attempt = 0; attempt < 5; attempt++) {
      const elapsed = Date.now() - this.lastRequest;
      if (elapsed < this.interval) await this.pause(this.interval - elapsed);
      this.lastRequest = Date.now();
      let response;
      try {
        response = await this.fetcher(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', 'User-Agent': 'Charta/0.1 (personal archive migration)' }, redirect: 'error', signal: AbortSignal.timeout(60000) });
      } catch {
        if (attempt === 4) throw new Error(`Are.na could not be reached: ${url.pathname}`);
        await this.pause(800 * 2 ** attempt); continue;
      }
      if (response.status === 429) {
        const reset = Number(response.headers.get('X-RateLimit-Reset')) * 1000 - Date.now();
        const retry = Number(response.headers.get('Retry-After')) * 1000;
        const wait = Math.min(120000, Math.max(1000, retry || reset || 10000));
        this.log(`Are.na rate limit: pausing ${Math.ceil(wait / 1000)} seconds.`);
        await this.pause(wait); continue;
      }
      if (response.status >= 500 && attempt < 4) { await this.pause(1000 * 2 ** attempt); continue; }
      if (!response.ok) {
        const error = new Error(`Are.na returned HTTP ${response.status} for ${url.pathname}.`);
        error.status = response.status; throw error;
      }
      return response.json();
    }
    throw new Error(`Are.na request could not finish: ${url.pathname}`);
  }

  async list(resource, { onPage = () => {} } = {}) {
    const results = []; let page = 1; let expected;
    for (let iteration = 0; iteration < 10000; iteration++) {
      const url = new URL(resource, API);
      url.searchParams.set('page', String(page)); url.searchParams.set('per', '50');
      const body = await this.get(url.href);
      if (!Array.isArray(body.data)) throw new Error(`Invalid Are.na list response: ${url.pathname}`);
      results.push(...body.data);
      expected = body.meta?.total_count ?? expected;
      await onPage(body, results);
      const more = body.meta?.has_more_pages ?? (body.meta?.next_page != null || page < (body.meta?.total_pages || 1));
      if (!more) return { data: results, expected, pages: page };
      if (!body.data.length) throw new Error(`Are.na pagination ended early: ${url.pathname}`);
      const next = Number(body.meta?.next_page) || page + 1;
      if (next <= page) throw new Error(`Are.na returned a repeated page: ${url.pathname}`);
      page = next;
    }
    throw new Error('Are.na pagination exceeded its safety limit.');
  }
}

export async function readTemporaryToken() {
  if (process.env.ARENA_TOKEN) return process.env.ARENA_TOKEN;
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdout.write('Ready for temporary Are.na token on stdin (input hidden).\n');
  return new Promise((resolve, reject) => {
    let input = '';
    const clean = () => { process.stdin.off('data', receive); process.stdin.pause(); if (process.stdin.isTTY) process.stdin.setRawMode(false); };
    function receive(chunk) {
      if (String(chunk).includes('\u0003')) { clean(); reject(new Error('Import cancelled.')); return; }
      input += chunk;
      if (/[\r\n]/.test(input)) { const token = input.trim(); input = ''; clean(); resolve(token); }
    }
    process.stdin.setEncoding('utf8'); process.stdin.on('data', receive); process.stdin.resume();
  });
}
