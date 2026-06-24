import 'dotenv/config';
import express from 'express';
import { createHash, randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const MCP_URL       = process.env.MCP_SERVER_URL;
const SF_CLIENT_ID  = process.env.SF_CLIENT_ID;
// Separate app (client ID) for Models API. Must be a DIFFERENT app than
// SF_CLIENT_ID — a single app can't hold valid mcp_api and api tokens at once
// (the second authorization invalidates the first). Falls back to SF_CLIENT_ID.
const SF_MODELS_CLIENT_ID = process.env.SF_MODELS_CLIENT_ID || SF_CLIENT_ID;
const SF_LOGIN_URL  = process.env.SF_LOGIN_URL  || 'https://login.salesforce.com';
const SF_TOKEN_URL  = process.env.SF_TOKEN_URL  || 'https://login.salesforce.com';
const CALLBACK_URL  = process.env.CALLBACK_URL  || 'http://localhost:3334/oauth/callback';
const PORT          = parseInt(process.env.PORT || '3334', 10);
const APP_URL       = process.env.APP_URL || `http://localhost:${PORT}`;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const SF_API_VERSION = process.env.SF_API_VERSION || 'v60.0';

// ── Data connections ──────────────────────────────────────────────────────────
// Three ways to reach Salesforce data, switchable live from the dashboard. Each
// has a transport (how queries run) and an auth model (how it gets a token).
//   - mcp  : query via the MCP `soqlQuery` tool over an HTTP transport
//   - cli  : shell out to the `sf` CLI (the connected-app-backed local session)
const EXTERNAL_MCP_URL = process.env.EXTERNAL_MCP_URL || '';
const SF_CLI_ORG       = process.env.SF_CLI_ORG || '';

const CONNECTIONS = {
  'eca-external-mcp': {
    id: 'eca-external-mcp',
    label: 'External MCP Tools',
    sublabel: 'ECA · third-party MCP',
    transport: 'mcp',
    auth: 'oauth',
    clientId: process.env.EXTERNAL_MCP_CLIENT_ID || '',
    scope: 'mcp_api refresh_token',
    mcpUrl: EXTERNAL_MCP_URL,
    // Available only once both an endpoint and a client id are configured.
    get available() { return !!(this.clientId && this.mcpUrl); },
  },
  'eca-sf-mcp': {
    id: 'eca-sf-mcp',
    label: 'Salesforce MCP',
    sublabel: 'ECA · SF-hosted MCP',
    transport: 'mcp',
    auth: 'oauth',
    clientId: SF_CLIENT_ID || '',
    scope: 'mcp_api refresh_token',
    mcpUrl: MCP_URL,
    get available() { return !!(this.clientId && this.mcpUrl); },
  },
  // The `sf` CLI session is itself backed by a connected app, so we surface it
  // AS the connected-app connection — no separate legacy OAuth app needed (and
  // the dxdo trial org blocks connected-app creation anyway).
  'cli': {
    id: 'cli',
    label: 'Connected App',
    sublabel: `sf CLI · ${SF_CLI_ORG || 'default org'}`,
    transport: 'cli',
    auth: 'cli',
    cliOrg: SF_CLI_ORG,
    // The CLI path needs no in-app OAuth; assume available and surface errors
    // at query time if the org isn't authenticated locally.
    get available() { return true; },
  },
};

// Active data connection (the LLM-provider toggle is a separate concern).
let activeConnection = process.env.DEFAULT_CONNECTION || 'cli';

// LLM Gateway (takes priority over direct Anthropic)
const GW_URL   = process.env.LLM_GATEWAY_URL   || '';
const GW_KEY   = process.env.LLM_GATEWAY_KEY   || '';
const GW_USER  = process.env.LLM_GATEWAY_USER  || '';
const GW_MODEL = process.env.LLM_GATEWAY_MODEL || 'claude-3-5-sonnet-20241022';

const anthropic = (!GW_URL && ANTHROPIC_KEY) ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;
const llmEnabled = !!(GW_URL || anthropic);

// ── LLM Provider Toggle ─────────────────────────────────────────────────────
// 'external' = Anthropic/Gateway (no Trust Layer)
// 'models-api' = Salesforce Models API (Trust Layer applies)
let llmProvider = 'external';

// Salesforce Models API configuration
const SF_MODELS_API_MODEL = process.env.SF_MODELS_API_MODEL || 'sfdc_ai__DefaultOpenAIGPT4OmniMini';

// ── LLM abstraction ──────────────────────────────────────────────────────────

function gwHeaders() {
  const h = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GW_KEY}` };
  if (GW_USER) h['x-user-id'] = GW_USER;
  return h;
}

/** Salesforce Models API completion — routes through Trust Layer */
async function sfModelsApiComplete(systemPrompt, userContent) {
  const token = await getModelsAccessToken();
  
  const prompt = `${systemPrompt}\n\nUser: ${userContent}`;
  
  // Use the Einstein Platform Models REST API (api.salesforce.com).
  // This endpoint applies the Trust Layer and uses the x-sfdc-app-context
  // header instead of a registered AI application name.
  const url = `https://api.salesforce.com/einstein/platform/v1/models/${SF_MODELS_API_MODEL}/generations`;
  console.log(`  [Models API] POST ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-sfdc-app-context': 'EinsteinGPT',
      'x-client-feature-id': 'ai-platform-models-connected-app',
    },
    body: JSON.stringify({
      prompt,
      localization: { defaultLocale: 'en_US', inputLocales: [{ locale: 'en_US', probability: 1 }], expectedLocales: ['en_US'] },
    }),
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.log(`  [Models API] ${res.status} ${res.statusText} | ct=${res.headers.get('content-type')} | body=${err.slice(0, 300)}`);
    throw new Error(`Models API error ${res.status}: ${err.slice(0, 300)}`);
  }
  
  const data = await res.json();
  console.log(`  [Models API] Response received, Trust Layer applied ✅`);
  return data.generation?.generatedText ?? data.generations?.[0]?.text ?? '';
}

/** Salesforce Models API streaming — routes through Trust Layer */
async function sfModelsApiStream(systemPrompt, messages, res) {
  const token = await getModelsAccessToken();
  
  // Build conversation as prompt
  const convo = messages.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');
  const prompt = `${systemPrompt}\n\n${convo}\nAssistant:`;
  
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  
  const write = text => res.write(`data: ${JSON.stringify({ text })}\n\n`);
  
  try {
    // Use the Einstein Platform Models REST API (api.salesforce.com).
    const apiRes = await fetch(`https://api.salesforce.com/einstein/platform/v1/models/${SF_MODELS_API_MODEL}/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'x-sfdc-app-context': 'EinsteinGPT',
        'x-client-feature-id': 'ai-platform-models-connected-app',
      },
      body: JSON.stringify({
        prompt,
        localization: { defaultLocale: 'en_US', inputLocales: [{ locale: 'en_US', probability: 1 }], expectedLocales: ['en_US'] },
      }),
    });
    
    if (!apiRes.ok) {
      const err = await apiRes.text();
      throw new Error(`Models API error ${apiRes.status}: ${err.slice(0, 300)}`);
    }
    
    const data = await apiRes.json();
    const text = data.generation?.generatedText ?? data.generations?.[0]?.text ?? '';
    
    // Log if response contains update blocks (for debugging)
    if (text.includes('salesforce-update')) {
      console.log(`  [Models API] Response contains salesforce-update block ✅`);
    } else if (text.toLowerCase().includes('update') || text.toLowerCase().includes('stage')) {
      console.log(`  [Models API] Response mentions update but NO JSON block ❌`);
      console.log(`  [Models API] Response preview: ${text.slice(0, 300)}...`);
    }
    
    // Models API doesn't stream, so we simulate chunks for consistent UX
    const words = text.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      write(words.slice(i, i + 3).join(' ') + ' ');
      await new Promise(r => setTimeout(r, 30));
    }
    
    console.log(`  [Models API] Streaming response complete, Trust Layer applied ✅`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}

/** Non-streaming completion — returns the assistant message text. */
async function llmComplete(systemPrompt, userContent, modelId) {
  // Route to Salesforce Models API if that provider is selected
  if (llmProvider === 'models-api') {
    console.log(`  [LLM] Using Salesforce Models API (Trust Layer ✅)`);
    return sfModelsApiComplete(systemPrompt, userContent);
  }
  
  console.log(`  [LLM] Using external provider (Trust Layer ❌)`);
  if (GW_URL) {
    const res = await fetch(`${GW_URL}/v1/chat/completions`, {
      method:  'POST',
      headers: gwHeaders(),
      body: JSON.stringify({
        model:    modelId || GW_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gateway error ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  if (anthropic) {
    const modelMap = {
      'claude-opus-4-7':   'claude-opus-4-5',
      'claude-sonnet-4-6': 'claude-sonnet-4-5',
      'claude-haiku-3-5':  'claude-haiku-3-5-20241022',
    };
    const msg = await anthropic.messages.create({
      model:      modelMap[modelId] ?? 'claude-opus-4-5',
      max_tokens: 2048,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userContent }],
    });
    return msg.content[0]?.text ?? '';
  }

  return null;
}

/** Streaming completion — pipes SSE chunks to an Express `res`. */
async function llmStream(systemPrompt, messages, modelId, res) {
  // Route to Salesforce Models API if that provider is selected
  if (llmProvider === 'models-api') {
    console.log(`  [LLM Stream] Using Salesforce Models API (Trust Layer ✅)`);
    return sfModelsApiStream(systemPrompt, messages, res);
  }
  
  console.log(`  [LLM Stream] Using external provider (Trust Layer ❌)`);
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const write = text => res.write(`data: ${JSON.stringify({ text })}\n\n`);

  if (GW_URL) {
    const fetchRes = await fetch(`${GW_URL}/v1/chat/completions`, {
      method:  'POST',
      headers: gwHeaders(),
      body: JSON.stringify({
        model:    modelId || GW_MODEL,
        stream:   true,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    });
    if (!fetchRes.ok) {
      const err = await fetchRes.text();
      throw new Error(`Gateway error ${fetchRes.status}: ${err.slice(0, 200)}`);
    }
    const reader  = fetchRes.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const chunk = JSON.parse(payload);
          const text  = chunk.choices?.[0]?.delta?.content;
          if (text) write(text);
        } catch { /* malformed chunk */ }
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (anthropic) {
    const modelMap = {
      'claude-opus-4-7':   'claude-opus-4-5',
      'claude-sonnet-4-6': 'claude-sonnet-4-5',
      'claude-haiku-3-5':  'claude-haiku-3-5-20241022',
    };
    const stream = await anthropic.messages.create({
      model:      modelMap[modelId] ?? 'claude-opus-4-5',
      max_tokens: 2048,
      system:     systemPrompt,
      messages,
      stream:     true,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        write(event.delta.text);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  throw new Error('No LLM provider configured.');
}

// ── OAuth token store ───────────────────────────────────────────────────────

// Per-connection auth state (OAuth connections only). Keyed by connection id.
// `cli` needs no entry — its token comes from the `sf` CLI on demand.
const connAuth = {};
for (const id of Object.keys(CONNECTIONS)) {
  if (CONNECTIONS[id].auth === 'oauth') {
    connAuth[id] = { accessToken: null, refreshToken: null, expiresAt: 0, codeVerifier: null, instanceUrl: null };
  }
}

// Secondary auth - for Models API (api scope). Independent of data connection.
const authModels = { accessToken: null, refreshToken: null, expiresAt: 0, codeVerifier: null };

/** Is the given connection ready to serve data queries? */
function isConnectionAuthenticated(id = activeConnection) {
  const conn = CONNECTIONS[id];
  if (!conn) return false;
  if (conn.auth === 'cli') return conn.available;      // assume CLI session exists
  const a = connAuth[id];
  return !!(a && (a.accessToken || a.refreshToken));
}

function isAuthenticated() { return isConnectionAuthenticated(activeConnection); }
function isModelsAuthenticated() { return !!(authModels.accessToken || authModels.refreshToken); }

/** Resolve instance URL for the active connection (for REST calls). */
async function getInstanceUrl(id = activeConnection) {
  const conn = CONNECTIONS[id];
  if (conn?.auth === 'cli') return cliOrgInfo(conn.cliOrg).then(i => i.instanceUrl);
  return connAuth[id]?.instanceUrl || SF_LOGIN_URL;
}

/** Get a usable access token for the active data connection.
 *  Note: CLI mode does not expose a token (recent `sf` versions hide it) — it
 *  queries via `sf data query` instead, so this is never called for CLI. */
async function getDataToken(id = activeConnection) {
  const conn = CONNECTIONS[id];
  if (!conn) { const e = new Error('UNKNOWN_CONNECTION'); e.code = 'NOT_AUTHENTICATED'; throw e; }

  if (conn.auth === 'cli') {
    const e = new Error('CLI connection does not provide a bearer token'); e.code = 'NOT_AUTHENTICATED'; throw e;
  }

  const a = connAuth[id];
  if (a.accessToken && Date.now() < a.expiresAt) return a.accessToken;
  if (a.refreshToken) return doConnRefresh(id);
  const err = new Error('NOT_AUTHENTICATED'); err.code = 'NOT_AUTHENTICATED'; throw err;
}

async function doConnRefresh(id) {
  const conn = CONNECTIONS[id];
  const a = connAuth[id];
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: a.refreshToken, client_id: conn.clientId });
  const res = await fetch(`${SF_TOKEN_URL}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) { a.accessToken = a.refreshToken = null; const e = new Error('Token refresh failed'); e.code = 'NOT_AUTHENTICATED'; throw e; }
  const data = await res.json();
  a.accessToken = data.access_token;
  if (data.instance_url) a.instanceUrl = data.instance_url;
  a.expiresAt   = Date.now() + Math.max((data.expires_in ?? 7200) - 120, 0) * 1000;
  return a.accessToken;
}

// ── SF CLI bridge ─────────────────────────────────────────────────────────────
// Short-lived cache of `sf org display` output so we don't shell out per query.
const cliCache = { byOrg: new Map() };

async function cliOrgInfo(org) {
  const key = org || '(default)';
  const hit = cliCache.byOrg.get(key);
  if (hit && Date.now() < hit.expiry) return hit.promise;

  // Cache the in-flight promise so concurrent callers share one `sf` invocation.
  // We only read the instance URL here (the access token is hidden by recent
  // CLI versions); CLI queries go through `sf data query` instead.
  const promise = (async () => {
    const args = ['org', 'display', '--json'];
    if (org) args.push('--target-org', org);
    let stdout;
    try {
      ({ stdout } = await execFileAsync('sf', args, { maxBuffer: 1024 * 1024 }));
    } catch (err) {
      const detail = (err.stderr || err.message || '').toString().slice(0, 200);
      const e = new Error(`SF CLI not available or org not authenticated: ${detail}`);
      e.code = 'NOT_AUTHENTICATED';
      throw e;
    }
    const result = JSON.parse(stdout).result || {};
    return { accessToken: result.accessToken ?? null, instanceUrl: result.instanceUrl };
  })();

  // Cache for 5 minutes; evict on failure so the next request retries.
  cliCache.byOrg.set(key, { promise, expiry: Date.now() + 5 * 60 * 1000 });
  promise.catch(() => cliCache.byOrg.delete(key));
  return promise;
}

// Models API token management
async function getModelsAccessToken() {
  if (authModels.accessToken && Date.now() < authModels.expiresAt) return authModels.accessToken;
  if (authModels.refreshToken) return doModelsRefresh();
  const err = new Error('MODELS_NOT_AUTHENTICATED'); err.code = 'MODELS_NOT_AUTHENTICATED'; throw err;
}

async function doModelsRefresh() {
  console.log(`  [auth] Models API refresh attempt | hasRefreshToken: ${!!authModels.refreshToken}`);
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: authModels.refreshToken, client_id: SF_MODELS_CLIENT_ID });
  const res = await fetch(`${SF_TOKEN_URL}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!res.ok) { 
    const errText = await res.text();
    console.log(`  [auth] Models API refresh FAILED: ${res.status} | ${errText.slice(0, 200)}`);
    authModels.accessToken = authModels.refreshToken = null; 
    const e = new Error('Models token refresh failed'); 
    e.code = 'MODELS_NOT_AUTHENTICATED'; 
    throw e; 
  }
  const data = await res.json();
  authModels.accessToken = data.access_token;
  authModels.expiresAt   = Date.now() + Math.max((data.expires_in ?? 7200) - 120, 0) * 1000;
  console.log(`  [auth] Models API token refreshed ✅`);
  return authModels.accessToken;
}

function pkceVerifier()   { return randomBytes(32).toString('base64url'); }
function pkceChallenge(v) { return createHash('sha256').update(v).digest('base64url'); }

// ── Data-connection OAuth routes ──────────────────────────────────────────────
// One PKCE flow serves every OAuth connection. The connection id rides through
// the round-trip in the `state` param so the callback knows which store to fill.

app.get('/oauth/login', (req, res) => {
  // Connect the requested connection, or the active one by default.
  const id = req.query.connection || activeConnection;
  const conn = CONNECTIONS[id];
  if (!conn || conn.auth !== 'oauth') {
    return res.redirect(`${APP_URL}/?auth_error=${encodeURIComponent(`Connection '${id}' does not use OAuth`)}`);
  }
  if (!conn.clientId) {
    return res.redirect(`${APP_URL}/?auth_error=${encodeURIComponent(`Connection '${id}' has no Client ID configured`)}`);
  }
  connAuth[id].codeVerifier = pkceVerifier();
  const params = new URLSearchParams({
    response_type: 'code', client_id: conn.clientId, redirect_uri: CALLBACK_URL,
    code_challenge: pkceChallenge(connAuth[id].codeVerifier), code_challenge_method: 'S256',
    scope: conn.scope, state: id,
  });
  res.redirect(`${SF_LOGIN_URL}/services/oauth2/authorize?${params}`);
});

app.get('/oauth/callback', async (req, res) => {
  const { code, error, state } = req.query;
  const id = state && CONNECTIONS[state] ? state : activeConnection;
  const conn = CONNECTIONS[id];
  if (error) return res.redirect(`${APP_URL}/?auth_error=${encodeURIComponent(error)}`);
  if (!code)  return res.redirect(`${APP_URL}/?auth_error=no_code`);
  try {
    const a = connAuth[id];
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: conn.clientId, redirect_uri: CALLBACK_URL, code_verifier: a.codeVerifier });
    const tokenRes = await fetch(`${SF_TOKEN_URL}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
    a.accessToken  = data.access_token;
    a.refreshToken = data.refresh_token;
    a.instanceUrl  = data.instance_url;
    a.expiresAt    = Date.now() + Math.max((data.expires_in ?? 7200) - 120, 0) * 1000;
    a.codeVerifier = null;
    activeConnection = id;  // newly-authenticated connection becomes active
    console.log(`  [auth] Connection '${id}' token acquired ✅`);
    // Auto-chain: immediately acquire the Models API token (api scope) so the
    // toggle can switch instantly later without a mid-session re-auth.
    res.redirect('/oauth/models-login');
  } catch (err) {
    res.redirect(`${APP_URL}/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/api/auth/status', (req, res) => res.json({
  authenticated: isAuthenticated(),
  activeConnection,
  modelsAuthenticated: isModelsAuthenticated(),
  loginUrl: `/oauth/login?connection=${activeConnection}`,
  modelsLoginUrl: '/oauth/models-login'
}));
app.post('/api/auth/logout', (req, res) => {
  for (const a of Object.values(connAuth)) { a.accessToken = a.refreshToken = null; a.expiresAt = 0; }
  authModels.accessToken = authModels.refreshToken = null; authModels.expiresAt = 0;
  res.json({ ok: true });
});

// ── Connection registry API ───────────────────────────────────────────────────

function connectionSummary() {
  return Object.values(CONNECTIONS).map(c => ({
    id: c.id,
    label: c.label,
    sublabel: c.sublabel,
    transport: c.transport,
    auth: c.auth,
    available: c.available,
    authenticated: isConnectionAuthenticated(c.id),
    active: c.id === activeConnection,
  }));
}

app.get('/api/connections', (req, res) => {
  res.json({ active: activeConnection, connections: connectionSummary() });
});

app.post('/api/connections/use', (req, res) => {
  const { id } = req.body || {};
  const conn = CONNECTIONS[id];
  if (!conn) return res.status(400).json({ ok: false, error: `Unknown connection '${id}'` });
  if (!conn.available) {
    return res.json({ ok: false, error: `Connection '${id}' is not configured`, available: false });
  }
  // OAuth connections that aren't authenticated yet need the login redirect.
  if (conn.auth === 'oauth' && !isConnectionAuthenticated(id)) {
    return res.json({ ok: false, needsAuth: true, loginUrl: `/oauth/login?connection=${id}` });
  }
  activeConnection = id;
  clearCache();  // different org/source → invalidate cached data
  console.log(`  [connection] Switched active data connection → '${id}'`);
  res.json({ ok: true, active: id, connections: connectionSummary() });
});

// ── Models API OAuth (separate token with 'api' scope) ───────────────────────

app.get('/oauth/models-login', (req, res) => {
  authModels.codeVerifier = pkceVerifier();
  const params = new URLSearchParams({
    response_type: 'code', client_id: SF_MODELS_CLIENT_ID, redirect_uri: CALLBACK_URL.replace('/callback', '/models-callback'),
    code_challenge: pkceChallenge(authModels.codeVerifier), code_challenge_method: 'S256',
    scope: 'sfap_api api refresh_token',
  });
  res.redirect(`${SF_LOGIN_URL}/services/oauth2/authorize?${params}`);
});

app.get('/oauth/models-callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect(`${APP_URL}/?models_auth_error=${encodeURIComponent(error)}`);
  if (!code)  return res.redirect(`${APP_URL}/?models_auth_error=no_code`);
  try {
    const body = new URLSearchParams({ 
      grant_type: 'authorization_code', code, client_id: SF_MODELS_CLIENT_ID, 
      redirect_uri: CALLBACK_URL.replace('/callback', '/models-callback'), 
      code_verifier: authModels.codeVerifier 
    });
    const tokenRes = await fetch(`${SF_TOKEN_URL}/services/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const data = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(data.error_description || data.error || 'Models token exchange failed');
    authModels.accessToken  = data.access_token;
    authModels.refreshToken = data.refresh_token;
    authModels.expiresAt    = Date.now() + Math.max((data.expires_in ?? 7200) - 120, 0) * 1000;
    authModels.codeVerifier = null;
    console.log(`  [auth] Models API token acquired ✅ | granted scopes: ${data.scope || '(none returned)'}`);
    res.redirect(APP_URL);
  } catch (err) {
    console.log('  [auth] Models API auth failed:', err.message);
    res.redirect(`${APP_URL}/?models_auth_error=${encodeURIComponent(err.message)}`);
  }
});

// ── LLM Provider Toggle endpoints ────────────────────────────────────────────

app.get('/api/llm/provider', (req, res) => {
  res.json({
    provider: llmProvider,
    trustLayer: llmProvider === 'models-api',
    modelsAuthenticated: isModelsAuthenticated(),
    modelsLoginUrl: '/oauth/models-login',
    description: llmProvider === 'models-api' 
      ? 'Salesforce Models API (Trust Layer ✅)' 
      : 'External Gateway (Trust Layer ❌)',
  });
});

app.post('/api/llm/use-external', (req, res) => {
  llmProvider = 'external';
  console.log(`  [toggle] Switched to external LLM provider — Trust Layer ❌`);
  res.json({ ok: true, provider: 'external', trustLayer: false });
});

app.post('/api/llm/use-models-api', (req, res) => {
  if (!isModelsAuthenticated()) {
    console.log(`  [toggle] Models API requires separate auth — redirecting to /oauth/models-login`);
    return res.json({ 
      ok: false, 
      needsAuth: true, 
      modelsLoginUrl: '/oauth/models-login',
      message: 'Models API requires additional authentication'
    });
  }
  llmProvider = 'models-api';
  console.log(`  [toggle] Switched to Salesforce Models API — Trust Layer ✅`);
  res.json({ ok: true, provider: 'models-api', trustLayer: true });
});

// ── Data query dispatch ───────────────────────────────────────────────────────
// soql() runs against whichever connection is active, using its transport.

async function withMcpClient(fn) {
  const conn = CONNECTIONS[activeConnection];
  const token = await getDataToken(activeConnection);
  const transport = new StreamableHTTPClientTransport(new URL(conn.mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'agentforce-today-remodel', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try { return await fn(client); } finally { try { await client.close(); } catch { /**/ } }
}

/** Run SOQL via MCP `soqlQuery` tool. */
async function soqlViaMcp(query) {
  return withMcpClient(async (client) => {
    const result = await client.callTool({ name: 'soqlQuery', arguments: { q: query } });
    const text = result?.content?.find(c => c.type === 'text')?.text;
    if (!text) throw new Error('MCP returned no content');
    return JSON.parse(text);
  });
}

/** Run SOQL via the REST query endpoint. Fallback for any future Bearer-token
 *  connection (no current mode uses it — MCP and CLI cover the active set). */
async function soqlViaRest(query) {
  const token = await getDataToken(activeConnection);
  const instanceUrl = await getInstanceUrl(activeConnection);
  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401) { const e = new Error('REST query unauthorized'); e.code = 'NOT_AUTHENTICATED'; throw e; }
    throw new Error(`REST query failed ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

/** Run SOQL via the `sf data query` CLI (no token extraction needed). */
async function soqlViaCli(query) {
  const conn = CONNECTIONS[activeConnection];
  const args = ['data', 'query', '--query', query, '--json'];
  if (conn.cliOrg) args.push('--target-org', conn.cliOrg);
  // The `sf` CLI auto-reads SF_API_VERSION from the environment but wants a
  // bare number (e.g. "60.0"), whereas our REST paths use the "v60.0" form.
  // Normalize it for the child so dotenv's value doesn't break the CLI.
  const childEnv = { ...process.env, SF_API_VERSION: SF_API_VERSION.replace(/^v/i, '') };
  let stdout;
  try {
    ({ stdout } = await execFileAsync('sf', args, { maxBuffer: 8 * 1024 * 1024, env: childEnv }));
  } catch (err) {
    // `sf` writes a JSON error payload to stdout even on non-zero exit.
    const payload = (err.stdout || '').toString();
    let msg = (err.stderr || err.message || '').toString().slice(0, 200);
    try { const j = JSON.parse(payload); if (j.message) msg = j.message; } catch { /* not json */ }
    const e = new Error(`SF CLI query failed: ${msg}`);
    e.code = 'NOT_AUTHENTICATED';
    throw e;
  }
  const parsed = JSON.parse(stdout);
  // Normalize to the REST/MCP shape: { records: [...], totalSize }
  return parsed.result ?? parsed;
}

async function soql(query) {
  const q = query.trim().replace(/\s+/g, ' ');
  const conn = CONNECTIONS[activeConnection];
  if (conn.transport === 'mcp') return soqlViaMcp(q);
  if (conn.transport === 'cli') return soqlViaCli(q);
  return soqlViaRest(q);
}

// ── Record Update (uses Models API token which has 'api' scope) ──────────────

async function updateRecord(objectType, recordId, fields) {
  const token = await getModelsAccessToken();
  const instanceUrl = (await getInstanceUrl().catch(() => null)) || SF_LOGIN_URL;

  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectType}/${recordId}`;
  console.log(`  [REST API] PATCH ${url}`);
  
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(fields),
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.log(`  [REST API] Update FAILED: ${res.status} | ${err.slice(0, 200)}`);
    throw new Error(`Update failed: ${res.status} - ${err.slice(0, 200)}`);
  }
  
  console.log(`  [REST API] Update successful ✅`);
  return { success: true, id: recordId };
}

async function createRecord(objectType, fields) {
  const token = await getModelsAccessToken();
  const instanceUrl = (await getInstanceUrl().catch(() => null)) || SF_LOGIN_URL;

  const url = `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectType}`;
  console.log(`  [REST API] POST ${url}`);
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(fields),
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.log(`  [REST API] Create FAILED: ${res.status} | ${err.slice(0, 200)}`);
    throw new Error(`Create failed: ${res.status} - ${err.slice(0, 200)}`);
  }
  
  const data = await res.json();
  console.log(`  [REST API] Create successful ✅ | id=${data.id}`);
  return { success: true, id: data.id };
}

// ── Data fetching ────────────────────────────────────────────────────────────

async function fetchSalesforceData() {
  const [oppsResult, leadsResult, casesResult, tasksResult] = await Promise.allSettled([
    soql(`SELECT Id, Name, Amount, StageName, CloseDate, Account.Name, NextStep, Probability, OwnerId
          FROM Opportunity WHERE IsClosed = false
          ORDER BY CloseDate ASC LIMIT 20`),
    soql(`SELECT Id, Name, Status, LeadSource, Company, CreatedDate, LastActivityDate
          FROM Lead WHERE IsConverted = false
          ORDER BY CreatedDate DESC LIMIT 15`),
    soql(`SELECT Id, CaseNumber, Subject, Status, Priority, Account.Name, AccountId, CreatedDate
          FROM Case WHERE IsClosed = false
          ORDER BY Priority DESC, CreatedDate DESC LIMIT 10`),
    soql(`SELECT Id, Subject, ActivityDate, Status, WhatId, What.Name, Priority
          FROM Task WHERE Status != 'Completed' AND ActivityDate <= NEXT_N_DAYS:14
          ORDER BY ActivityDate ASC NULLS LAST LIMIT 15`),
  ]);

  // Debug: log any failed queries
  if (oppsResult.status === 'rejected') console.log('  [MCP] Opportunities query FAILED:', oppsResult.reason?.message);
  if (leadsResult.status === 'rejected') console.log('  [MCP] Leads query FAILED:', leadsResult.reason?.message);
  if (casesResult.status === 'rejected') console.log('  [MCP] Cases query FAILED:', casesResult.reason?.message);
  if (tasksResult.status === 'rejected') console.log('  [MCP] Tasks query FAILED:', tasksResult.reason?.message);

  const result = {
    opportunities: oppsResult.status === 'fulfilled' ? (oppsResult.value?.records ?? []) : [],
    leads:         leadsResult.status  === 'fulfilled' ? (leadsResult.value?.records  ?? []) : [],
    cases:         casesResult.status  === 'fulfilled' ? (casesResult.value?.records  ?? []) : [],
    tasks:         tasksResult.status  === 'fulfilled' ? (tasksResult.value?.records  ?? []) : [],
  };
  
  console.log(`  [MCP] Data counts: Opps=${result.opportunities.length}, Leads=${result.leads.length}, Cases=${result.cases.length}, Tasks=${result.tasks.length}`);
  return result;
}

// ── Anthropic briefing generation ───────────────────────────────────────────

const BRIEFING_SYSTEM = `You are Agentforce Today, an AI sales intelligence assistant embedded in Salesforce.
Analyze the provided Salesforce data and generate a structured JSON response.

You MUST return ONLY valid JSON — no markdown fences, no explanation text before or after. 

The JSON structure must be:
{
  "score": <integer 0-200 representing overall pipeline health>,
  "briefings": [
    {
      "id": "<unique id>",
      "category": "<FORECAST|RISK|LEADS|CASES>",
      "title": "<compelling 8-12 word headline summarising the key insight>",
      "body": "<2-3 sentence analysis with specific numbers and context>",
      "stats": ["<stat 1>", "<stat 2>"],
      "priority": <1-5>
    }
  ],
  "actions": [
    {
      "id": "<unique id>",
      "text": "<specific action instruction starting with a verb, 20-40 words, naming the account>",
      "opportunityName": "<name of the related opportunity or null>",
      "opportunityId": "<Salesforce Id or null>",
      "urgency": "<HIGH|MEDIUM|LOW>"
    }
  ]
}

Rules:
- Generate 3-5 briefings, ordered by business impact descending.
- Generate 3-5 actions, ordered by urgency.
- Use specific dollar amounts, dates and counts from the data.
- Be direct and actionable — no filler phrases.
- Score reflects pipeline risk: 200 = perfect health, 0 = all at risk.`;

async function generateBriefings(sfData, modelId) {
  if (!llmEnabled) return fallbackBriefings(sfData);

  const dataStr = JSON.stringify({
    openOpportunities: sfData.opportunities,
    unconvertedLeads:  sfData.leads,
    openCases:         sfData.cases,
    upcomingTasks:     sfData.tasks,
    today:             new Date().toISOString().split('T')[0],
  }, null, 2);

  try {
    const raw     = await llmComplete(BRIEFING_SYSTEM, `Generate sales briefings from this Salesforce data:\n\n${dataStr}`, modelId);
    const cleaned = (raw ?? '{}').replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('LLM briefing error:', err.message);
    return fallbackBriefings(sfData);
  }
}

function fallbackBriefings(sfData) {
  const opps     = sfData.opportunities;
  const leads    = sfData.leads;
  const cases    = sfData.cases;
  const total    = opps.reduce((s, o) => s + (o.Amount || 0), 0);
  const atRisk   = opps.filter(o => (o.Probability ?? 100) < 30 || new Date(o.CloseDate) < new Date()).length;
  const closingSoon = opps.filter(o => { const d = new Date(o.CloseDate); const n = new Date(); return d >= n && (d - n) / 86400000 <= 30; }).length;
  const untouchedLeads = leads.filter(l => !l.LastActivityDate).length;

  const briefings = [];
  if (opps.length) {
    briefings.push({
      id: 'forecast', category: 'FORECAST',
      title: `$${(total / 1e6).toFixed(1)}M of open pipeline requires attention`,
      body:  `${closingSoon} deal${closingSoon !== 1 ? 's' : ''} close in the next 30 days. ${atRisk} opportunit${atRisk !== 1 ? 'ies carry' : 'y carries'} high-risk signals. Prioritise next steps with a dated commitment.`,
      stats: [`${opps.length} open deals`, `$${(total / 1e6).toFixed(1)}M pipeline`],
      priority: 1,
    });
  }
  if (atRisk > 0) {
    briefings.push({
      id: 'risk', category: 'RISK',
      title: `${atRisk} deal${atRisk !== 1 ? 's need' : ' needs'} immediate seller action`,
      body:  `${atRisk} opportunit${atRisk !== 1 ? 'ies are' : 'y is'} overdue or sitting below 30% probability. Without a clear next step and committed close date these are likely to slip.`,
      stats: [`${atRisk} at-risk deals`],
      priority: 2,
    });
  }
  if (untouchedLeads > 0) {
    briefings.push({
      id: 'leads', category: 'LEADS',
      title: `${untouchedLeads} unconverted lead${untouchedLeads !== 1 ? 's' : ''} still need a first touch`,
      body:  `${untouchedLeads} lead${untouchedLeads !== 1 ? 's have' : ' has'} never received a follow-up. Early outreach significantly improves conversion rates — assign and reach out today.`,
      stats: [`${leads.length} total open leads`, `${untouchedLeads} untouched`],
      priority: 3,
    });
  }
  if (cases.length) {
    briefings.push({
      id: 'cases', category: 'CASES',
      title: `${cases.length} open case${cases.length !== 1 ? 's' : ''} may be blocking revenue`,
      body:  `Open service cases on key accounts can delay renewals and expansion. Review and co-ordinate with your service team to unblock pipeline.`,
      stats: [`${cases.length} open cases`],
      priority: 4,
    });
  }

  // Build action items from opportunities closing soonest
  const actions = opps.slice(0, 3).map((o, i) => ({
    id: `action-${i + 1}`,
    text: `Review ${o.Name} on ${o.Account?.Name ?? 'account'} and confirm what needs to happen before it closes ${o.CloseDate}. Update the next step with a dated customer commitment.`,
    opportunityName: o.Name,
    opportunityId:   o.Id,
    urgency: i === 0 ? 'HIGH' : 'MEDIUM',
  }));

  return { score: Math.max(0, 200 - atRisk * 20 - untouchedLeads * 5), briefings, actions };
}

// ── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  if (!isAuthenticated()) return res.status(401).json({ error: 'NOT_AUTHENTICATED', loginUrl: '/oauth/login' });
  next();
}

// ── KPI and Chart aggregation helpers ────────────────────────────────────────

function computeKpis(sfData) {
  const opps = sfData.opportunities ?? [];
  const leads = sfData.leads ?? [];
  const cases = sfData.cases ?? [];
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const pipelineValue = opps.reduce((sum, o) => sum + (o.Amount || 0), 0);
  const atRiskDeals = opps.filter(o => 
    (o.Probability ?? 100) < 30 || new Date(o.CloseDate) < now
  ).length;
  const closingSoon = opps.filter(o => {
    const closeDate = new Date(o.CloseDate);
    return closeDate >= now && closeDate <= thirtyDaysFromNow;
  }).length;
  const highPriorityCases = cases.filter(c => c.Priority === 'High').length;

  return {
    openOpportunities: opps.length,
    pipelineValue,
    atRiskDeals,
    closingSoon,
    openCases: cases.length,
    highPriorityCases,
    openLeads: leads.length,
  };
}

function computeCharts(sfData) {
  const opps = sfData.opportunities ?? [];
  const leads = sfData.leads ?? [];

  // Pipeline by Stage
  const stageMap = {};
  for (const opp of opps) {
    const stage = opp.StageName || 'Unknown';
    if (!stageMap[stage]) stageMap[stage] = { stage, count: 0, value: 0 };
    stageMap[stage].count++;
    stageMap[stage].value += opp.Amount || 0;
  }
  const pipelineByStage = Object.values(stageMap)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);

  // Opportunity ranges (deal size distribution)
  const ranges = [
    { name: '$0-50K', min: 0, max: 50000, value: 0 },
    { name: '$50K-100K', min: 50000, max: 100000, value: 0 },
    { name: '$100K-250K', min: 100000, max: 250000, value: 0 },
    { name: '$250K-500K', min: 250000, max: 500000, value: 0 },
    { name: '$500K-1M', min: 500000, max: 1000000, value: 0 },
    { name: '$1M+', min: 1000000, max: Infinity, value: 0 },
  ];
  for (const opp of opps) {
    const amount = opp.Amount || 0;
    for (const range of ranges) {
      if (amount >= range.min && amount < range.max) {
        range.value++;
        break;
      }
    }
  }
  const opportunityRanges = ranges
    .filter(r => r.value > 0)
    .map(r => ({ name: r.name, value: r.value }));

  // Lead sources
  const sourceMap = {};
  for (const lead of leads) {
    const source = lead.LeadSource || 'Other';
    if (!sourceMap[source]) sourceMap[source] = { source, count: 0 };
    sourceMap[source].count++;
  }
  const leadSources = Object.values(sourceMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    pipelineByStage,
    opportunityRanges,
    leadSources,
  };
}

// ── API routes ───────────────────────────────────────────────────────────────

app.get('/api/today', requireAuth, async (req, res) => {
  const modelId = req.query.model ?? 'claude-opus-4-7';
  const forceRefresh = req.query.force === 'true';
  
  console.log(`\n[/api/today] model=${modelId}, force=${forceRefresh}`);
  const totalStart = Date.now();
  
  try {
    // Use cached data when available
    const sfData   = await getCachedSfData(forceRefresh);
    const aiResult = await getCachedBriefings(sfData, modelId, forceRefresh);

    // Compute KPIs and chart data (fast, no need to cache)
    const kpis = computeKpis(sfData);
    const charts = computeCharts(sfData);

    // Enrich actions with full opportunity details from fetched data
    const oppMap = Object.fromEntries(sfData.opportunities.map(o => [o.Id, o]));

    const relatedRecords = (aiResult.actions ?? [])
      .filter(a => a.opportunityId && oppMap[a.opportunityId])
      .map(a => {
        const o = oppMap[a.opportunityId];
        return {
          id:       o.Id,
          name:     o.Name,
          type:     'OPPORTUNITY',
          stage:    o.StageName,
          amount:   o.Amount ? `$${(o.Amount / 1e6).toFixed(1)}M` : 'N/A',
          closeDate: o.CloseDate,
          account:  o.Account?.Name ?? '',
          notes:    o.NextStep || 'No next step recorded. Close date approaching — action required.',
        };
      });

    // Fallback: use top opps if AI didn't return IDs
    const relatedFallback = relatedRecords.length === 0
      ? sfData.opportunities.slice(0, 3).map(o => ({
          id: o.Id, name: o.Name, type: 'OPPORTUNITY', stage: o.StageName,
          amount: o.Amount ? `$${(o.Amount / 1e6).toFixed(1)}M` : 'N/A',
          closeDate: o.CloseDate, account: o.Account?.Name ?? '',
          notes: o.NextStep || 'No next step recorded.',
        }))
      : relatedRecords;

    const dayNames  = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
    const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const now = new Date();

    const totalMs = Date.now() - totalStart;
    console.log(`[/api/today] Complete in ${totalMs}ms\n`);

    res.json({
      date:    `${dayNames[now.getDay()]} ${monthNames[now.getMonth()]} ${now.getDate()}`,
      score:   aiResult.score ?? 100,
      aiEnabled: llmEnabled,
      activeConnection,
      llmProvider,
      trustLayer: llmProvider === 'models-api',
      model:   modelId,
      kpis,
      charts,
      briefings:      aiResult.briefings ?? [],
      actions:        aiResult.actions   ?? [],
      relatedRecords: relatedFallback,
      _meta: { responseTimeMs: totalMs, cached: !forceRefresh && totalMs < 500 },
    });
  } catch (err) {
    console.error('/api/today error:', err.message);
    if (err.code === 'NOT_AUTHENTICATED') return res.status(401).json({ error: 'NOT_AUTHENTICATED', loginUrl: '/oauth/login' });
    res.status(500).json({ error: err.message });
  }
});

// ── LLM debug endpoint ───────────────────────────────────────────────────────

app.get('/api/llm/models', async (req, res) => {
  if (!GW_URL) return res.json({ provider: 'anthropic-direct', models: [] });
  try {
    const r = await fetch(`${GW_URL}/v1/models`, { headers: gwHeaders() });
    const body = await r.json();
    const models = body?.data?.map(m => m.id).sort() ?? body;
    res.json({ status: r.status, models });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get('/api/llm/test', async (req, res) => {
  if (!GW_URL) return res.json({ provider: 'anthropic-direct', model: 'N/A' });
  try {
    const testRes = await fetch(`${GW_URL}/v1/chat/completions`, {
      method:  'POST',
      headers: gwHeaders(),
      body: JSON.stringify({
        model:      GW_MODEL,
        max_tokens: 32,
        messages:   [{ role: 'user', content: 'Reply with just the word: hello' }],
      }),
    });
    const rawText = await testRes.text();
    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch { /* not JSON */ }
    res.json({ status: testRes.status, statusText: testRes.statusText, rawBody: rawText.slice(0, 1000), parsed });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── Chat endpoint (streaming SSE) ───────────────────────────────────────────

const CHAT_SYSTEM = `You are a sharp, concise Salesforce sales intelligence assistant embedded in "Agentforce Today".
You have full access to the current state of the user's Salesforce CRM data provided below.
Answer questions about opportunities, leads, pipeline, deals, close dates, accounts and actions — always citing specific names, amounts and dates from the data.
Be direct: no filler phrases, no "Great question!", no bullet-point padding when prose works better.
If asked what to focus on, be opinionated and specific. Format numbers as currency where appropriate.
Today's date: {TODAY}.

RECORD UPDATE CAPABILITY:
You can update Salesforce records. When the user asks to update, change, or modify a record, you MUST output a JSON code block with the tag "salesforce-update". This is required for the update to actually happen.

IMPORTANT: Always output the JSON block - without it, no update occurs!

Example - to update an Opportunity stage:
\`\`\`salesforce-update
{"action":"update","objectType":"Opportunity","recordId":"006XXXXXXXXXXXX","fields":{"StageName":"Negotiation/Review"}}
\`\`\`

Example - to update NextStep:
\`\`\`salesforce-update
{"action":"update","objectType":"Opportunity","recordId":"006XXXXXXXXXXXX","fields":{"NextStep":"Schedule demo"}}
\`\`\`

Example - to create a Task:
\`\`\`salesforce-update
{"action":"create","objectType":"Task","fields":{"Subject":"Follow up","WhatId":"006XXXXXXXXXXXX","ActivityDate":"2026-06-20","Priority":"High"}}
\`\`\`

Rules:
1. Use the actual record ID from the SALESFORCE DATA below (look for the "Id" field)
2. Always wrap the JSON in \`\`\`salesforce-update and \`\`\` tags
3. Say what you're updating, then output the JSON block
4. Only do this when the user explicitly asks to update/change something

SALESFORCE DATA:
{SF_DATA}`;

// ── Caching layer ────────────────────────────────────────────────────────────

const cache = {
  sfData: null,
  sfDataExpiry: 0,
  briefings: new Map(),  // Map<modelId, { data, expiry }>
  TTL: 3 * 60 * 1000,    // 3 minutes
};

async function getCachedSfData(forceRefresh = false) {
  if (!forceRefresh && cache.sfData && Date.now() < cache.sfDataExpiry) {
    console.log('  [cache] Salesforce data: HIT');
    return cache.sfData;
  }
  console.log('  [cache] Salesforce data: MISS - fetching from MCP...');
  const start = Date.now();
  cache.sfData = await fetchSalesforceData();
  cache.sfDataExpiry = Date.now() + cache.TTL;
  console.log(`  [cache] Salesforce data fetched in ${Date.now() - start}ms`);
  return cache.sfData;
}

async function getCachedBriefings(sfData, modelId, forceRefresh = false) {
  const cacheKey = modelId;
  const cached = cache.briefings.get(cacheKey);
  
  if (!forceRefresh && cached && Date.now() < cached.expiry) {
    console.log(`  [cache] AI briefings (${modelId}): HIT`);
    return cached.data;
  }
  
  console.log(`  [cache] AI briefings (${modelId}): MISS - generating...`);
  const start = Date.now();
  const data = await generateBriefings(sfData, modelId);
  cache.briefings.set(cacheKey, { data, expiry: Date.now() + cache.TTL });
  console.log(`  [cache] AI briefings generated in ${Date.now() - start}ms`);
  return data;
}

function clearCache() {
  cache.sfData = null;
  cache.sfDataExpiry = 0;
  cache.briefings.clear();
  console.log('  [cache] Cleared all caches');
}

// ── Record Update Endpoints ──────────────────────────────────────────────────

app.post('/api/update-record', requireAuth, async (req, res) => {
  const { objectType, recordId, fields } = req.body;
  
  if (!objectType || !recordId || !fields) {
    return res.status(400).json({ error: 'Missing required fields: objectType, recordId, fields' });
  }
  
  try {
    const result = await updateRecord(objectType, recordId, fields);
    clearCache(); // Clear cache so next fetch gets updated data
    res.json(result);
  } catch (err) {
    console.error('[/api/update-record] error:', err.message);
    if (err.code === 'MODELS_NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'MODELS_NOT_AUTHENTICATED', message: 'Models API auth required for updates', modelsLoginUrl: '/oauth/models-login' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/create-record', requireAuth, async (req, res) => {
  const { objectType, fields } = req.body;
  
  if (!objectType || !fields) {
    return res.status(400).json({ error: 'Missing required fields: objectType, fields' });
  }
  
  try {
    const result = await createRecord(objectType, fields);
    clearCache();
    res.json(result);
  } catch (err) {
    console.error('[/api/create-record] error:', err.message);
    if (err.code === 'MODELS_NOT_AUTHENTICATED') {
      return res.status(401).json({ error: 'MODELS_NOT_AUTHENTICATED', message: 'Models API auth required for creates', modelsLoginUrl: '/oauth/models-login' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Chat endpoint (streaming SSE) ───────────────────────────────────────────

app.post('/api/chat', requireAuth, async (req, res) => {
  if (!llmEnabled) {
    return res.status(501).json({ error: 'LLM_NOT_CONFIGURED', message: 'Set LLM_GATEWAY_URL + LLM_GATEWAY_KEY (or ANTHROPIC_API_KEY) in .env to enable chat.' });
  }

  const { messages = [], model: modelId } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const sfData = await getCachedSfData();

    const systemPrompt = CHAT_SYSTEM
      .replace('{TODAY}', new Date().toDateString())
      .replace('{SF_DATA}', JSON.stringify({
        openOpportunities: sfData.opportunities,
        unconvertedLeads:  sfData.leads,
        openCases:         sfData.cases,
        upcomingTasks:     sfData.tasks,
      }, null, 2));

    await llmStream(systemPrompt, messages.map(m => ({ role: m.role, content: m.content })), modelId, res);
  } catch (err) {
    console.error('/api/chat error:', err.message);
    if (!res.headersSent) {
      if (err.code === 'NOT_AUTHENTICATED') return res.status(401).json({ error: 'NOT_AUTHENTICATED', loginUrl: '/oauth/login' });
      if (err.code === 'MODELS_NOT_AUTHENTICATED') return res.status(401).json({ error: 'MODELS_NOT_AUTHENTICATED', modelsLoginUrl: '/oauth/models-login' });
      return res.status(500).json({ error: err.message });
    }
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); res.end(); } catch { /**/ }
  }
});

// ── Serve built frontend ─────────────────────────────────────────────────────

const DIST = path.join(__dirname, 'dist');
app.use(express.static(DIST));
app.get('*', (req, res) => {
  const index = path.join(DIST, 'index.html');
  res.sendFile(index, err => {
    if (err) res.status(404).send('Run `npm run build` first, or use `npm run dev` during development.');
  });
});

app.listen(PORT, () => {
  console.log(`\n  Agentforce Today Remodel  →  http://localhost:${PORT}`);
  console.log(`  Data connections          →  ${Object.values(CONNECTIONS).map(c => `${c.id}${c.available ? '' : ' (unconfigured)'}${c.id === activeConnection ? ' [active]' : ''}`).join(', ')}`);
  const llmDesc = GW_URL ? `Gateway → ${GW_URL}` : anthropic ? 'Anthropic Claude (direct)' : 'fallback (no LLM configured)';
  console.log(`  AI / Chat                 →  ${llmDesc}\n`);
});
