// Small Supabase client: sign-in, database, file storage and live updates.
// Uses only fetch and WebSocket, so the app has no outside code to load.
// The key below is the project's public (anon) key: it is meant to be in the app.
// What people can do is enforced by the database rules, not by this key.

const SB_URL = 'https://udburardbmxfozcfimms.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVkYnVyYXJkYm14Zm96Y2ZpbW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQwNjM1MjYsImV4cCI6MjEwOTYzOTUyNn0.LsgQXtIWs1JFjn_k5QTtM1x_CvY9N0ulivjhp5RoYpY';
const BUCKET = 'finishes';

class SupaError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function readError(res) {
  let msg = res.status + ' ' + res.statusText;
  try {
    const j = await res.json();
    msg = j.msg || j.error_description || j.message || j.error || msg;
  } catch (e) { /* not json */ }
  return new SupaError(msg, res.status);
}

class Supa {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.session = null;
    try { this.session = JSON.parse(localStorage.getItem('df_session') || 'null'); } catch (e) { this.session = null; }
  }

  saveSession(s) {
    this.session = s;
    try {
      if (s) localStorage.setItem('df_session', JSON.stringify(s));
      else localStorage.removeItem('df_session');
    } catch (e) { /* storage blocked */ }
  }

  get email() { return this.session && this.session.user ? this.session.user.email : null; }

  headers(json = true) {
    const h = { apikey: this.key, Authorization: 'Bearer ' + (this.session ? this.session.access_token : this.key) };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  // ---------- auth
  async authCall(path, body) {
    const res = await fetch(this.url + '/auth/v1/' + path, {
      method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw await readError(res);
    return res.json();
  }

  storeTokens(j) {
    const exp = j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600);
    this.saveSession({ access_token: j.access_token, refresh_token: j.refresh_token, expires_at: exp, user: j.user });
  }

  async signIn(email, password) {
    const j = await this.authCall('token?grant_type=password', { email, password });
    this.storeTokens(j);
    return j;
  }

  // Returns true when signed in right away, false when a confirmation email was sent.
  async signUp(email, password, redirectTo) {
    const q = redirectTo ? 'signup?redirect_to=' + encodeURIComponent(redirectTo) : 'signup';
    const j = await this.authCall(q, { email, password });
    if (j.access_token) { this.storeTokens(j); return true; }
    return false;
  }

  async refresh() {
    if (!this.session || !this.session.refresh_token) return false;
    try {
      const j = await this.authCall('token?grant_type=refresh_token', { refresh_token: this.session.refresh_token });
      this.storeTokens(j);
      return true;
    } catch (e) {
      if (e.status >= 400 && e.status < 500) this.saveSession(null);   // refresh token no longer valid
      return false;
    }
  }

  async fresh() {
    if (this.session && this.session.expires_at - Date.now() / 1000 < 120) await this.refresh();
  }

  async signOut() {
    const s = this.session;
    this.saveSession(null);
    if (s) {
      try {
        await fetch(this.url + '/auth/v1/logout', { method: 'POST', headers: { apikey: this.key, Authorization: 'Bearer ' + s.access_token } });
      } catch (e) { /* offline is fine */ }
    }
  }

  // ---------- database (PostgREST)
  async rest(method, path, body, prefer) {
    await this.fresh();
    const h = this.headers(true);
    if (prefer) h.Prefer = prefer;
    const res = await fetch(this.url + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw await readError(res);
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  }

  select(table, query) { return this.rest('GET', table + '?' + query); }

  upsert(table, rows, onConflict) {
    return this.rest('POST', table + '?on_conflict=' + onConflict, rows, 'resolution=merge-duplicates,return=representation');
  }

  update(table, filter, patch) { return this.rest('PATCH', table + '?' + filter, patch, 'return=representation'); }

  remove(table, filter) { return this.rest('DELETE', table + '?' + filter, undefined, 'return=minimal'); }

  rpc(fn, args) { return this.rest('POST', 'rpc/' + fn, args || {}); }

  // ---------- storage
  async upload(path, blob, contentType) {
    await this.fresh();
    const h = this.headers(false);
    h['Content-Type'] = contentType;
    h['cache-control'] = 'max-age=31536000';
    const res = await fetch(this.url + '/storage/v1/object/' + BUCKET + '/' + path, { method: 'POST', headers: h, body: blob });
    if (!res.ok) throw await readError(res);
    return path;
  }

  async removeFiles(paths) {
    if (!paths.length) return;
    await this.fresh();
    const res = await fetch(this.url + '/storage/v1/object/' + BUCKET, { method: 'DELETE', headers: this.headers(true), body: JSON.stringify({ prefixes: paths }) });
    if (!res.ok) throw await readError(res);
  }

  publicUrl(path) { return this.url + '/storage/v1/object/public/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/'); }
}

// Live updates over the Supabase Realtime websocket (Phoenix protocol).
class Live {
  constructor(sb, tables, onChange, onStatus) {
    this.sb = sb; this.tables = tables; this.onChange = onChange; this.onStatus = onStatus;
    this.ws = null; this.ref = 0; this.hb = null; this.wait = 1000; this.up = false; this.stopped = false;
  }

  start() { this.stopped = false; this.open(); }

  stop() { this.stopped = true; clearInterval(this.hb); if (this.ws) this.ws.close(); }

  restart() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } clearInterval(this.hb); this.open(); }

  send(topic, event, payload) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ref += 1;
    this.ws.send(JSON.stringify({ topic, event, payload, ref: String(this.ref), join_ref: '1' }));
  }

  status(up) { if (up !== this.up) { this.up = up; this.onStatus(up); } }

  open() {
    const u = this.sb.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(this.sb.key) + '&vsn=1.0.0';
    let ws;
    try { ws = new WebSocket(u); } catch (e) { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.wait = 1000;
      const token = this.sb.session ? this.sb.session.access_token : this.sb.key;
      this.send('realtime:donato-finishes', 'phx_join', {
        config: { broadcast: { self: false }, presence: { key: '' },
          postgres_changes: this.tables.map(t => ({ event: '*', schema: 'public', table: t })) },
        access_token: token
      });
      clearInterval(this.hb);
      this.hb = setInterval(() => this.send('phoenix', 'heartbeat', {}), 25000);
    };
    ws.onmessage = (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch (e) { return; }
      if (msg.event === 'phx_reply' && msg.topic === 'realtime:donato-finishes') {
        if (msg.payload && msg.payload.status === 'ok') this.status(true);
      } else if (msg.event === 'postgres_changes' && msg.payload && msg.payload.data) {
        this.onChange(msg.payload.data.table, msg.payload.data);
      } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
        this.status(false);
      }
    };
    ws.onclose = () => { this.status(false); clearInterval(this.hb); this.retry(); };
    ws.onerror = () => { /* onclose follows */ };
  }

  retry() {
    if (this.stopped) return;
    setTimeout(() => this.open(), this.wait);
    this.wait = Math.min(30000, this.wait * 2);
  }
}
