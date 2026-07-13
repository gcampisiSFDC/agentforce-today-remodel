import 'dotenv/config';
import express from 'express';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

// On Windows the `sf` CLI is a `.cmd` shim: Node's execFile can't launch a bare
// `sf` (ENOENT — no extension resolution), and Node 22+ refuses to spawn a
// `.cmd` without a shell. Running through a shell, in turn, would treat SOQL
// characters like `>` as redirection. So on Windows we invoke `sf.cmd` via the
// shell but hand it a single, fully double-quoted command line (SOQL literals
// use single quotes, so double-quote wrapping is safe). Elsewhere we execFile
// `sf` directly with the args array.
const IS_WIN = process.platform === 'win32';

async function runSf(args, opts = {}) {
  if (!IS_WIN) return execFileAsync('sf', args, opts);
  const quote = a => `"${String(a).replace(/"/g, '\\"')}"`;
  const cmd = ['sf.cmd', ...args.map(quote)].join(' ');
  // windowsVerbatimArguments: pass our pre-quoted command line through untouched
  // — otherwise Node re-quotes each element and mangles the SOQL string.
  return execFileAsync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmd], { ...opts, windowsVerbatimArguments: true });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const MCP_URL       = process.env.MCP_SERVER_URL;
const SF_CLIENT_ID  = process.env.SF_CLIENT_ID;
// Separate app (client ID) for Models API. Must be a DIFFERENT app than
// SF_CLIENT_ID — a single app can't hold valid mcp_api and api tokens at once
// (the second authorization invalidates the first). Falls back to SF_CLIENT_ID.
const SF_MODELS_CLIENT_ID = process.env.SF_MODELS_CLIENT_ID || SF_CLIENT_ID;
// ── ECA Trace: a second tracked ECA (the locally-installed Salesforce DX MCP) ──
// Its Event-Monitoring `Application` string is org-dependent, so it's
// configurable. SF_DXMCP_CLIENT_ID is only used to surface (masked) in the UI.
// ECA_LOGIN_LOOKBACK_HOURS bounds how far back logins are indexed for the
// session-based attribution join (see correlateEcaTraffic).
const SF_DXMCP_APP_NAME  = process.env.SF_DXMCP_APP_NAME  || 'Salesforce DX MCP';
const SF_DXMCP_CLIENT_ID = process.env.SF_DXMCP_CLIENT_ID || '';
const ECA_LOGIN_LOOKBACK_HOURS = parseInt(process.env.ECA_LOGIN_LOOKBACK_HOURS || '24', 10);
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
// Auth models: 'oauth' (Salesforce ECA / PKCE), 'token' (a static bearer the
// external server itself issues — NOT a Salesforce scope), 'cli' (local CLI).
const EXTERNAL_MCP_URL   = process.env.EXTERNAL_MCP_URL || '';
const EXTERNAL_MCP_TOKEN = process.env.EXTERNAL_MCP_TOKEN || '';
const SF_CLI_ORG         = process.env.SF_CLI_ORG || '';

const CONNECTIONS = {
  // A third-party / self-hosted MCP server (e.g. the Salesforce DX MCP server,
  // or any non-Salesforce MCP endpoint). It is NOT a Salesforce OAuth client, so
  // it carries no `mcp_api`/ECA scopes — the server defines its own auth. We
  // attach an optional bearer token (EXTERNAL_MCP_TOKEN) if the server wants one;
  // servers that need no auth (or use the local CLI session, like the DX MCP
  // server) just leave it blank. NOTE: this targets an HTTP-reachable MCP
  // endpoint; a stdio-only server like `@salesforce/mcp` needs an HTTP bridge.
  'eca-external-mcp': {
    id: 'eca-external-mcp',
    label: 'External MCP Tools',
    sublabel: 'third-party MCP · own auth',
    transport: 'mcp',
    auth: 'token',
    token: EXTERNAL_MCP_TOKEN,
    mcpUrl: EXTERNAL_MCP_URL,
    // Available once an endpoint is set — the token is optional (server's call).
    get available() { return !!this.mcpUrl; },
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

// ── Bedrock-style gateway (Anthropic Messages API over an AWS Bedrock proxy) ──
// The Salesforce internal model gateway that Claude Code / the Agent SDK uses
// speaks the Anthropic Messages API at `{base}/model/{id}/invoke`, authed with a
// bearer token instead of AWS SigV4. We reuse the same env vars that CLI sets
// (ANTHROPIC_BEDROCK_BASE_URL + ANTHROPIC_AUTH_TOKEN) so launching the server
// from an authenticated shell needs no secrets on disk. BEDROCK_GW_* overrides
// win if you want to point at a different gateway/token explicitly.
const BEDROCK_GW_URL   = (process.env.BEDROCK_GW_URL || process.env.ANTHROPIC_BEDROCK_BASE_URL || '').replace(/\/$/, '');
// Bedrock model IDs verified against the gateway. The app's UI model ids map to
// these; unmapped ids fall back to BEDROCK_GW_MODEL.
const BEDROCK_GW_MODEL = process.env.BEDROCK_GW_MODEL || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const BEDROCK_MODEL_MAP = {
  'claude-opus-4-7':            'us.anthropic.claude-sonnet-4-5-20250929-v1:0', // opus-4-x not on this key
  'claude-sonnet-4-6':          'us.anthropic.claude-sonnet-5',
  'claude-sonnet-4-5-20250929': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-haiku-4-5-20251001':  'us.anthropic.claude-haiku-4-5-20251001-v1:0',
};

// ── Bedrock token: live rotation sync ─────────────────────────────────────────
// The gateway bearer (ANTHROPIC_AUTH_TOKEN) is short-lived and rotates. Claude
// Code's tooling rewrites the new value into ~/.claude/settings.json, so we read
// from there at call time rather than snapshotting the startup env — no restart
// needed when it rotates. Precedence: explicit BEDROCK_GW_TOKEN override > the
// settings.json value (freshest) > the process env at launch. A tiny TTL keeps
// us from hitting disk on every request; on a 401 we force a re-read (below).
const CLAUDE_SETTINGS_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '', '.claude', 'settings.json');
let _bedrockTokenCache = { value: null, readAt: 0 };
const BEDROCK_TOKEN_TTL = 60 * 1000;

function readBedrockTokenFromSettings() {
  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf8');
    return JSON.parse(raw)?.env?.ANTHROPIC_AUTH_TOKEN || '';
  } catch { return ''; }
}

/** Current gateway bearer, honoring live rotation. `force` skips the TTL cache. */
function getBedrockToken(force = false) {
  if (process.env.BEDROCK_GW_TOKEN) return process.env.BEDROCK_GW_TOKEN;  // explicit override
  const now = Date.now();
  if (!force && _bedrockTokenCache.value && now - _bedrockTokenCache.readAt < BEDROCK_TOKEN_TTL) {
    return _bedrockTokenCache.value;
  }
  // Prefer the on-disk value (rewritten on rotation); fall back to launch env.
  const token = readBedrockTokenFromSettings() || process.env.ANTHROPIC_AUTH_TOKEN || '';
  _bedrockTokenCache = { value: token, readAt: now };
  return token;
}

/** Is the Bedrock gateway usable right now (URL + a resolvable token)? */
function bedrockGwEnabled() { return !!(BEDROCK_GW_URL && getBedrockToken()); }

const anthropic = (!GW_URL && ANTHROPIC_KEY) ? new Anthropic({ apiKey: ANTHROPIC_KEY }) : null;
// Whether the *external* provider (Anthropic direct, the OpenAI-style gateway,
// or the Bedrock-style gateway) is configured. The Models API provider is gated
// separately, on ECA auth — see isLlmEnabled() below.
function externalLlmEnabled() { return !!(GW_URL || anthropic || bedrockGwEnabled()); }

// ── LLM Provider Toggle ─────────────────────────────────────────────────────
// 'external' = Anthropic/Gateway (no Trust Layer)
// 'models-api' = Salesforce Models API (Trust Layer applies)
// Defaults to the Salesforce Models API — the documented primary provider
// (see .env). The external provider is opt-in via an Anthropic key / gateway.
let llmProvider = process.env.DEFAULT_LLM_PROVIDER || 'models-api';

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

/** Resolve an app model id to a Bedrock model id the gateway serves. */
function bedrockModelFor(modelId) {
  return BEDROCK_MODEL_MAP[modelId] || BEDROCK_GW_MODEL;
}

/** One call to the Bedrock gateway with a specific token. Returns the Response.*/
async function bedrockGwFetch(systemPrompt, messages, modelId, token) {
  const model = bedrockModelFor(modelId);
  const url = `${BEDROCK_GW_URL}/model/${encodeURIComponent(model)}/invoke`;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    }),
  });
}

/** Call the Bedrock-style gateway (Anthropic Messages API), non-streaming.
 *  Resolves the bearer token live (see getBedrockToken) so a rotated token is
 *  picked up without a restart; on a 401/403 we force-refresh from settings.json
 *  and retry once, covering the case where the token rotated mid-cache-window.
 *  Returns the concatenated text of all text blocks (skips `thinking` blocks
 *  that reasoning models like sonnet-5 emit first). */
async function bedrockGwInvoke(systemPrompt, messages, modelId) {
  let res = await bedrockGwFetch(systemPrompt, messages, modelId, getBedrockToken());

  if (res.status === 401 || res.status === 403) {
    const fresh = getBedrockToken(true);  // rotation? re-read settings.json now
    console.log('  [Bedrock] auth rejected — re-read token from settings.json, retrying');
    res = await bedrockGwFetch(systemPrompt, messages, modelId, fresh);
  }

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401 || res.status === 403) {
      const e = new Error(`Bedrock gateway auth failed (${res.status}) — token expired; relaunch an authenticated Claude Code shell`);
      e.code = 'NOT_AUTHENTICATED';
      throw e;
    }
    throw new Error(`Bedrock gateway error ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/** Non-streaming completion — returns the assistant message text. */
async function llmComplete(systemPrompt, userContent, modelId) {
  // Route to Salesforce Models API if that provider is selected
  if (llmProvider === 'models-api') {
    console.log(`  [LLM] Using Salesforce Models API (Trust Layer ✅)`);
    return sfModelsApiComplete(systemPrompt, userContent);
  }

  // Bedrock-style gateway (the credential Claude Code / the Agent SDK uses).
  if (bedrockGwEnabled()) {
    console.log(`  [LLM] Using Bedrock gateway → ${bedrockModelFor(modelId)} (Trust Layer ❌)`);
    return bedrockGwInvoke(systemPrompt, [{ role: 'user', content: userContent }], modelId);
  }

  console.log(`  [LLM] Using external provider (Trust Layer ❌)`);
  return llmCompleteExternal(systemPrompt, userContent, modelId);
}

/** Legacy external paths: OpenAI-style gateway, then Anthropic direct. */
async function llmCompleteExternal(systemPrompt, userContent, modelId) {
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

  // Bedrock-style gateway. Its native stream is AWS eventstream binary framing,
  // which is fragile to hand-parse — so we call the clean /invoke once and
  // simulate word chunks for a consistent streaming UX (same as Models API).
  if (bedrockGwEnabled()) {
    console.log(`  [LLM Stream] Using Bedrock gateway → ${bedrockModelFor(modelId)} (Trust Layer ❌)`);
    try {
      const text = await bedrockGwInvoke(systemPrompt, messages, modelId);
      const words = text.split(' ');
      for (let i = 0; i < words.length; i += 3) {
        write(words.slice(i, i + 3).join(' ') + ' ');
        await new Promise(r => setTimeout(r, 20));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      write(`\n\n[Bedrock gateway error: ${err.message}]`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }

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
  if (conn.auth === 'token') return conn.available;    // external server owns auth
  const a = connAuth[id];
  return !!(a && (a.accessToken || a.refreshToken));
}

function isAuthenticated() { return isConnectionAuthenticated(activeConnection); }
function isModelsAuthenticated() { return !!(authModels.accessToken || authModels.refreshToken); }

/** Is an LLM ready to generate briefings/chat for the *current* provider?
 *  - models-api: needs the Models API ECA authenticated (sfap_api/api token).
 *  - external:   needs a gateway URL or an Anthropic key configured. */
function isLlmEnabled() {
  return llmProvider === 'models-api' ? isModelsAuthenticated() : externalLlmEnabled();
}

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

  // A 'token' connection (third-party / self-hosted MCP) carries a static bearer
  // the external server itself issued, if any. May be empty for no-auth servers.
  if (conn.auth === 'token') return conn.token || '';

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
      ({ stdout } = await runSf(args, { maxBuffer: 1024 * 1024 }));
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
  // Only send an Authorization header if we actually have a token — a no-auth
  // external MCP server gets a clean request.
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const transport = new StreamableHTTPClientTransport(new URL(conn.mcpUrl), { requestInit: { headers } });
  const client = new Client({ name: 'agentforce-today-remodel', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  try { return await fn(client); } finally { try { await client.close(); } catch { /**/ } }
}

/**
 * Parse SOQL tool output from MCP servers that may return:
 * - strict JSON text
 * - markdown-fenced JSON
 * - JSON embedded in explanatory text
 * - a structured object in content/data fields
 */
function parseMcpSoqlResult(result) {
  const extractText = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n');
    if (typeof value === 'object') {
      if (typeof value.text === 'string') return value.text;
      if (typeof value.content === 'string') return value.content;
      if (typeof value.value === 'string') return value.value;
      if (typeof value.data === 'string') return value.data;
      if (value.content || value.data) return extractText(value.content || value.data);
    }
    return '';
  };

  const tryParseJsonText = (text) => {
    if (!text) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Common model/tool wrapper: ```json ... ```
      const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced?.[1]) {
        try { return JSON.parse(fenced[1]); } catch { /* keep trying */ }
      }
      // Recover first JSON object/array from mixed text.
      const firstObj = trimmed.indexOf('{');
      const firstArr = trimmed.indexOf('[');
      const startCandidates = [firstObj, firstArr].filter(i => i >= 0);
      if (!startCandidates.length) return null;
      const start = Math.min(...startCandidates);
      const endObj = trimmed.lastIndexOf('}');
      const endArr = trimmed.lastIndexOf(']');
      const end = Math.max(endObj, endArr);
      if (end > start) {
        const candidate = trimmed.slice(start, end + 1);
        try { return JSON.parse(candidate); } catch { /* not parseable */ }
      }
      return null;
    }
  };

  // Some MCP servers return structured content directly.
  if (typeof result?.structuredContent === 'object' && result.structuredContent) {
    return result.structuredContent;
  }
  if (typeof result?.data === 'object' && result.data) {
    return result.data;
  }

  const textFromContent = extractText(result?.content);
  const parsedFromContent = tryParseJsonText(textFromContent);
  if (parsedFromContent) return parsedFromContent;

  const parsedFromResultText = tryParseJsonText(result?.text);
  if (parsedFromResultText) return parsedFromResultText;

  // Last-ditch: if the first content item has an object `data`, use it.
  const contentData = result?.content?.find?.(c => c && typeof c.data === 'object')?.data;
  if (contentData) return contentData;

  const preview = (textFromContent || result?.text || '').toString().slice(0, 200).replace(/\s+/g, ' ');
  throw new Error(`MCP returned non-JSON SOQL payload${preview ? `: ${preview}` : ''}`);
}

/** Run SOQL via MCP `soqlQuery` tool. */
async function soqlViaMcp(query) {
  return withMcpClient(async (client) => {
    const result = await client.callTool({ name: 'soqlQuery', arguments: { q: query } });
    const parsed = parseMcpSoqlResult(result);
    // Normalize several likely server payload shapes to { records, totalSize }.
    if (Array.isArray(parsed?.records)) return parsed;
    if (Array.isArray(parsed?.result?.records)) return parsed.result;
    if (Array.isArray(parsed?.data?.records)) return parsed.data;
    if (Array.isArray(parsed)) return { records: parsed, totalSize: parsed.length };
    throw new Error('MCP SOQL payload missing records array');
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
  const parseSfCliJson = (raw) => {
    const stripAnsi = s => s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
    const text = stripAnsi((raw || '').toString())
      .replace(/^\uFEFF/, '')        // UTF-8 BOM
      .replace(/\u0000/g, '')        // stray NUL bytes
      .trim();
    if (!text) throw new Error('Empty SF CLI output');
    try { return JSON.parse(text); } catch {
      // Recover JSON from mixed/noisy stdout (warnings, prefixes, etc.).
      const firstObj = text.indexOf('{');
      const firstArr = text.indexOf('[');
      const starts = [firstObj, firstArr].filter(i => i >= 0);
      if (!starts.length) throw new Error('SF CLI did not return JSON');
      const start = Math.min(...starts);
      const endObj = text.lastIndexOf('}');
      const endArr = text.lastIndexOf(']');
      const end = Math.max(endObj, endArr);
      if (end <= start) throw new Error('SF CLI JSON payload is truncated');
      return JSON.parse(text.slice(start, end + 1));
    }
  };
  let stdout;
  try {
    ({ stdout } = await runSf(args, { maxBuffer: 8 * 1024 * 1024, env: childEnv }));
  } catch (err) {
    // `sf` writes its JSON payload to stdout even on non-zero exit. On Windows
    // the cmd.exe wrapper can also exit non-zero for a *successful* query — a
    // deprecation/api-version warning on stderr flips the exit code even though
    // stdout holds a clean `{ status: 0, result: {...} }`. So try to recover a
    // successful payload from stdout before treating this as a real failure.
    const payload = (err.stdout || '').toString();
    try {
      const j = parseSfCliJson(payload);
      if (j.status === 0 && j.result) return j.result;   // genuine success despite exit code
      const e = new Error(`SF CLI query failed: ${(j.message || 'unknown error').slice(0, 200)}`);
      e.code = 'NOT_AUTHENTICATED';
      throw e;
    } catch (parseErr) {
      if (parseErr.code === 'NOT_AUTHENTICATED') throw parseErr;
      if (payload) {
        console.log(`  [CLI] Non-JSON stdout on non-zero exit (preview): ${payload.slice(0, 220).replace(/\s+/g, ' ')}`);
      }
      const msg = (err.stderr || err.message || '').toString().slice(0, 200);
      const e = new Error(`SF CLI query failed: ${msg}`);
      e.code = 'NOT_AUTHENTICATED';
      throw e;
    }
  }
  let parsed;
  try {
    parsed = parseSfCliJson(stdout);
  } catch (err) {
    const raw = (stdout || '').toString();
    const charCodes = raw.slice(0, 12).split('').map(ch => ch.charCodeAt(0)).join(',');
    console.log(`  [CLI] JSON parse failed for stdout preview: ${raw.slice(0, 220).replace(/\s+/g, ' ')}`);
    console.log(`  [CLI] stdout first char codes: ${charCodes}`);
    throw err;
  }
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
  if (!isLlmEnabled()) return fallbackBriefings(sfData);

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
      aiEnabled: isLlmEnabled(),
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
  if (!isLlmEnabled()) {
    const message = llmProvider === 'models-api'
      ? 'Models API selected but not authenticated. Connect the Models API ECA via /oauth/models-login, or set an Anthropic key / gateway and switch to the external provider.'
      : 'Set LLM_GATEWAY_URL + LLM_GATEWAY_KEY (or ANTHROPIC_API_KEY) in .env to enable chat.';
    return res.status(501).json({ error: 'LLM_NOT_CONFIGURED', message, provider: llmProvider });
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

// ── Real-Time Event Monitoring ────────────────────────────────────────────────
// The heart of the demo: stream Salesforce Event Monitoring logs live and show
// how each *connection type* the app uses surfaces (or fails to surface) in them.
//
// Findings verified against the dxdo org:
//   • LoginEvent.Application is the reliable discriminator — it reads
//     "SF MCP", "SF MODELS", "Salesforce CLI" or "Browser", mapping 1:1 to the
//     app's connection types (eca-sf-mcp, Models API, cli, and the user login).
//   • ApiEvent rows produced by MCP- and CLI-routed queries carry
//     ConnectedAppId = null and Application = "N/A" — the observability gap the
//     README calls out. We surface that per row so it's visible, not hidden.
//   • These are queryable big objects: filterable by EventDate (NOT by
//     ConnectedAppId, which is select-only), so we poll by EventDate and
//     classify/filter the connection client-side.

const EVENTS_POLL_MS = parseInt(process.env.EVENTS_POLL_MS || '6000', 10);

// Event types we stream. `fields` are verified-present columns; `time` is the
// timestamp column to page on (all use EventDate here).
const EVENT_TYPES = {
  LoginEvent: {
    label: 'Login',
    fields: 'EventIdentifier, EventDate, Username, Application, LoginType, Browser, Platform, Status, SourceIp, SessionKey, LoginHistoryId, LoginKey',
  },
  LoginAsEvent: {
    label: 'Login-As',
    fields: 'EventIdentifier, EventDate, Username, DelegatedUsername, Application, LoginType, SourceIp, SessionKey, LoginHistoryId, LoginKey',
  },
  ApiEvent: {
    label: 'API',
    fields: 'EventIdentifier, EventDate, Username, Application, ConnectedAppId, Operation, QueriedEntities, ApiType, RowsReturned, RowsProcessed, SourceIp, SessionKey, LoginHistoryId, LoginKey',
  },
  LogoutEvent: {
    label: 'Logout',
    fields: 'EventIdentifier, EventDate, Username, SourceIp',
  },
  ReportEvent: {
    label: 'Report',
    fields: 'EventIdentifier, EventDate, Username, Operation, QueriedEntities',
  },
  LightningUriEvent: {
    label: 'Lightning UI',
    fields: 'EventIdentifier, EventDate, Username, Operation, AppName, PageUrl',
  },
};

// Tracked External Client Apps for the ECA Trace view. Each is an ECA whose
// individual API calls carry no ConnectedAppId (Remote Access 2.0 login), so we
// attribute their traffic by correlating on session identifiers instead.
const TRACKED_ECAS = {
  'sf-mcp': { id: 'sf-mcp', label: 'Hosted MCP',        appName: 'SF MCP',          clientId: SF_CLIENT_ID },
  'dx-mcp': { id: 'dx-mcp', label: 'Salesforce DX MCP', appName: SF_DXMCP_APP_NAME, clientId: SF_DXMCP_CLIENT_ID },
};
// Generic Application strings that must never be treated as a tracked ECA — even
// if an operator misconfigures SF_DXMCP_APP_NAME to one of them. Guards the
// exact-name match in classifyConnection so a shared name stays ambiguous.
const RESERVED_APP_NAMES = new Set(['SALESFORCE CLI', 'BROWSER', 'SF MODELS', 'N/A']);

// How each connection surfaces in Event Monitoring. Drives the UI legend.
const CONNECTION_LEGEND = {
  'sf-mcp':    { label: 'Salesforce MCP',   sublabel: 'ECA · mcp_api',     match: 'Application = "SF MCP"',       tracesToApp: false },
  'sf-models': { label: 'Models API',       sublabel: 'ECA · sfap_api/api', match: 'Application = "SF MODELS"',   tracesToApp: true  },
  'dx-mcp':    { label: 'Salesforce DX MCP', sublabel: 'ECA · local CLI',  match: `Application = "${SF_DXMCP_APP_NAME}"`, tracesToApp: false },
  'cli':       { label: 'Connected App',    sublabel: 'sf CLI session',    match: 'Application = "Salesforce CLI"', tracesToApp: true  },
  'browser':   { label: 'User (Browser)',   sublabel: 'interactive login', match: 'Application = "Browser"',      tracesToApp: true  },
  'other':     { label: 'Other',            sublabel: 'unrelated traffic', match: '—',                            tracesToApp: null  },
};

/** Map an Event Monitoring Application/AppName to one of the app's connection types. */
function classifyConnection(application) {
  const raw = (application || '').trim();
  const a = raw.toUpperCase();
  // Match the exact configured DX MCP app name FIRST so its (possibly generic-
  // looking) string isn't swallowed by the includes() rules below — but refuse
  // to honour a reserved/ambiguous name (see edge cases: DX MCP vs CLI).
  const dxName = (SF_DXMCP_APP_NAME || '').trim().toUpperCase();
  if (dxName && a === dxName && !RESERVED_APP_NAMES.has(dxName)) return 'dx-mcp';
  if (a.includes('MCP'))     return 'sf-mcp';
  if (a.includes('MODEL'))   return 'sf-models';
  if (a.includes('CLI'))     return 'cli';
  if (a.includes('BROWSER')) return 'browser';
  return 'other';
}

/** Flatten a raw event record into the shape the frontend renders. */
function normalizeEvent(type, r) {
  const application = r.Application ?? r.AppName ?? null;
  const connection = classifyConnection(application);
  // The "observability gap": an ApiEvent whose originating connected app can't
  // be identified (ConnectedAppId null / Application N/A) is untraceable to the
  // app that made the call — exactly what happens for MCP- and CLI-routed calls.
  const hasConnectedApp = !!(r.ConnectedAppId && r.ConnectedAppId !== 'null');
  const appTraceable = type === 'ApiEvent'
    ? hasConnectedApp
    : (CONNECTION_LEGEND[connection]?.tracesToApp ?? null);

  return {
    id:              r.EventIdentifier || `${type}-${r.EventDate}-${Math.round((new Date(r.EventDate)).getTime())}`,
    type,
    typeLabel:       EVENT_TYPES[type]?.label ?? type,
    eventDate:       r.EventDate,
    username:        r.Username ?? null,
    application,
    connection,
    connectionLabel: CONNECTION_LEGEND[connection]?.label ?? connection,
    connectedAppId:  r.ConnectedAppId ?? null,
    appTraceable,
    // Type-specific detail (only what's set for that type comes through).
    loginType:       r.LoginType ?? null,
    status:          r.Status ?? null,
    browser:         r.Browser ?? null,
    platform:        r.Platform ?? null,
    operation:       r.Operation ?? null,
    queriedEntities: r.QueriedEntities ?? null,
    apiType:         r.ApiType ?? null,
    rowsReturned:    r.RowsReturned ?? null,
    delegatedUser:   r.DelegatedUsername ?? null,
    pageUrl:         r.PageUrl ?? null,
    sourceIp:        r.SourceIp ?? null,
    // Session identifiers — the join keys for ECA Trace attribution. Harmless
    // nulls on event types that don't carry them.
    sessionKey:      r.SessionKey ?? null,
    loginHistoryId:  r.LoginHistoryId ?? null,
    loginKey:        r.LoginKey ?? null,
  };
}

/** Query one event type since an ISO timestamp (inclusive). Returns [] on any
 *  per-type failure so one unavailable object doesn't kill the whole stream. */
async function fetchEventType(type, sinceIso, limit = 50) {
  const def = EVENT_TYPES[type];
  if (!def) return [];
  // EventDate is filterable; ConnectedAppId is not — so we page purely on time.
  const where = sinceIso ? `WHERE EventDate > ${sinceIso}` : '';
  const q = `SELECT ${def.fields} FROM ${type} ${where} ORDER BY EventDate DESC LIMIT ${limit}`;
  try {
    const res = await soql(q);
    return (res?.records ?? []).map(r => normalizeEvent(type, r));
  } catch (err) {
    // A type may be unavailable on the org/edition, or unauthorized — skip it
    // rather than failing the whole stream. Logged at debug depth only.
    if (process.env.EVENTS_DEBUG) console.log(`  [events] ${type} skipped: ${err.message?.slice(0, 160)}`);
    return [];
  }
}

/** Fetch a batch across the requested types, newest first. */
async function fetchEvents({ types, sinceIso, perTypeLimit = 40 }) {
  const wanted = (types && types.length) ? types.filter(t => EVENT_TYPES[t]) : Object.keys(EVENT_TYPES);
  const batches = await Promise.all(wanted.map(t => fetchEventType(t, sinceIso, perTypeLimit)));
  return batches.flat().sort((a, b) => new Date(b.eventDate) - new Date(a.eventDate));
}

// Static metadata for the UI: the type registry + connection legend + which
// connected-app client IDs the app itself uses.
app.get('/api/events/meta', (req, res) => {
  res.json({
    types: Object.entries(EVENT_TYPES).map(([id, d]) => ({ id, label: d.label })),
    connections: Object.entries(CONNECTION_LEGEND).map(([id, d]) => ({ id, ...d })),
    pollMs: EVENTS_POLL_MS,
    activeConnection,
    appClientIds: {
      mcp:    SF_CLIENT_ID ? `…${SF_CLIENT_ID.slice(-8)}` : null,
      models: SF_MODELS_CLIENT_ID ? `…${SF_MODELS_CLIENT_ID.slice(-8)}` : null,
      dxMcp:  SF_DXMCP_CLIENT_ID ? `…${SF_DXMCP_CLIENT_ID.slice(-8)}` : null,
    },
    // The ECAs the ECA Trace view attributes traffic to. One meta fetch serves
    // both the Event Monitor and the ECA Trace tab.
    trackedEcas: Object.values(TRACKED_ECAS).map(e => ({
      id: e.id, label: e.label, appName: e.appName,
      clientIdMasked: e.clientId ? `…${e.clientId.slice(-8)}` : null,
    })),
  });
});

// One-shot pull (backfill / manual refresh).
app.get('/api/events', requireAuth, async (req, res) => {
  const types = (req.query.types ? String(req.query.types).split(',') : []).map(s => s.trim()).filter(Boolean);
  const hours = Math.min(parseInt(req.query.hours || '24', 10) || 24, 24 * 30);
  const sinceIso = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  try {
    const events = await fetchEvents({ types, sinceIso, perTypeLimit: 60 });
    res.json({ events, activeConnection, count: events.length });
  } catch (err) {
    console.error('[/api/events] error:', err.message);
    if (err.code === 'NOT_AUTHENTICATED') return res.status(401).json({ error: 'NOT_AUTHENTICATED', loginUrl: '/oauth/login' });
    res.status(500).json({ error: err.message });
  }
});

// Live SSE stream. Backfills recent events, then polls for anything newer and
// pushes only rows not already seen (deduped by EventIdentifier).
app.get('/api/events/stream', requireAuth, async (req, res) => {
  const types = (req.query.types ? String(req.query.types).split(',') : []).map(s => s.trim()).filter(Boolean);
  const backfillHours = Math.min(parseInt(req.query.hours || '6', 10) || 6, 24 * 7);

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const seen = new Set();
  const remember = ev => { seen.add(ev.id); if (seen.size > 5000) seen.clear(); };
  let watermark = new Date(Date.now() - backfillHours * 3600 * 1000).toISOString();
  let closed = false;
  let timer = null;

  send('status', { message: 'connected', activeConnection, pollMs: EVENTS_POLL_MS });

  async function poll(isBackfill) {
    if (closed) return;
    try {
      const events = await fetchEvents({ types, sinceIso: watermark, perTypeLimit: isBackfill ? 60 : 30 });
      const fresh = events.filter(e => !seen.has(e.id));
      fresh.forEach(remember);
      // Advance the watermark to the newest event we've seen.
      for (const e of fresh) { if (e.eventDate && e.eventDate > watermark) watermark = e.eventDate; }
      if (fresh.length) {
        // Oldest-first so the client appends in chronological order.
        send('events', { events: fresh.slice().reverse(), backfill: !!isBackfill, activeConnection });
      } else if (!isBackfill) {
        send('heartbeat', { at: watermark, activeConnection });
      }
    } catch (err) {
      send('error', { message: err.message, code: err.code || null });
    }
  }

  await poll(true);
  timer = setInterval(() => poll(false), EVENTS_POLL_MS);

  req.on('close', () => { closed = true; if (timer) clearInterval(timer); try { res.end(); } catch { /**/ } });
});

// ── Real-Time Event Monitoring — ECA Trace ─────────────────────────────────────
// Closes the observability gap the Event Monitor exposes. ApiEvent.ConnectedAppId
// is only stamped for classic Connected Apps — the tracked ECAs (Hosted MCP, DX
// MCP) log in as Remote Access 2.0, so their individual API calls carry no
// ConnectedAppId. We instead attribute each ApiEvent to an ECA by correlating on
// session identifiers (SessionKey → LoginHistoryId → LoginKey) shared with the
// LoginEvent that started the session. LoginEvent/ApiEvent are filterable ONLY by
// EventDate, so the correlation is a JS post-fetch join, never a SOQL WHERE.

function newEcaIndex() {
  return { bySession: new Map(), byHistory: new Map(), byLoginKey: new Map(), logins: [] };
}

/** Index tracked-ECA logins by their session identifiers. First-seen wins on a
 *  key collision; callers pass logins newest-first (fetchEvents sorts DESC), so
 *  the newest login owns a reused key. Returns how many tracked logins were added. */
function indexEcaLogins(index, loginEvents) {
  let added = 0;
  for (const login of loginEvents) {
    const ecaId = classifyConnection(login.application);
    if (ecaId !== 'sf-mcp' && ecaId !== 'dx-mcp') continue;   // only tracked ECAs
    const entry = { ecaId, login };
    if (login.sessionKey     && !index.bySession.has(login.sessionKey))     index.bySession.set(login.sessionKey, entry);
    if (login.loginHistoryId && !index.byHistory.has(login.loginHistoryId)) index.byHistory.set(login.loginHistoryId, entry);
    if (login.loginKey       && !index.byLoginKey.has(login.loginKey))      index.byLoginKey.set(login.loginKey, entry);
    index.logins.push(entry);
    added++;
  }
  return added;
}

/** Attribute one ApiEvent to a tracked ECA via the session-id join, in priority
 *  order. Returns { ecaId, login, matchedKey } or null (→ the observability gap). */
function attributeApiEvent(index, ev) {
  if (ev.sessionKey     && index.bySession.has(ev.sessionKey))     return { ...index.bySession.get(ev.sessionKey),     matchedKey: 'session' };
  if (ev.loginHistoryId && index.byHistory.has(ev.loginHistoryId)) return { ...index.byHistory.get(ev.loginHistoryId), matchedKey: 'history' };
  if (ev.loginKey       && index.byLoginKey.has(ev.loginKey))      return { ...index.byLoginKey.get(ev.loginKey),      matchedKey: 'login'   };
  return null;
}

function trackedEcaSummary() {
  return Object.values(TRACKED_ECAS).map(e => ({
    id: e.id, label: e.label, appName: e.appName,
    clientIdMasked: e.clientId ? `…${e.clientId.slice(-8)}` : null,
  }));
}

const splitEntities = qe => (qe ? String(qe).split(',').map(s => s.trim()).filter(Boolean) : []);

/** Build the full TraceResult snapshot from an index of logins + a list of
 *  ApiEvents. Re-attributes every ApiEvent against the current index, so a login
 *  that arrived after its ApiEvent moves the row into its group on the next build. */
function buildTraceResult({ index, apiEvents, rawLoginCount, window }) {
  const groups = new Map();
  const ensureGroup = (ecaId) => {
    if (!groups.has(ecaId)) {
      const eca = TRACKED_ECAS[ecaId];
      groups.set(ecaId, {
        ecaId, label: eca?.label ?? ecaId, appName: eca?.appName ?? null,
        sessions: new Map(), apiEvents: [], entities: new Set(), operations: {},
      });
    }
    return groups.get(ecaId);
  };

  // Seed each group with its captured sessions so a group with logins but no
  // (yet) attributed API calls still renders.
  for (const entry of index.logins) {
    const g = ensureGroup(entry.ecaId);
    const l = entry.login;
    const skey = l.sessionKey || l.loginHistoryId || l.loginKey || l.id;
    if (!g.sessions.has(skey)) {
      g.sessions.set(skey, {
        sessionKey: l.sessionKey, loginHistoryId: l.loginHistoryId, loginKey: l.loginKey,
        username: l.username, loginAt: l.eventDate, loginType: l.loginType, sourceIp: l.sourceIp,
      });
    }
  }

  const unattr = { apiEvents: [], entities: new Set() };
  for (const ev of apiEvents) {
    const match = attributeApiEvent(index, ev);
    if (match) {
      const g = ensureGroup(match.ecaId);
      g.apiEvents.push({ ...ev, attributedTo: match.ecaId, matchedKey: match.matchedKey });
      splitEntities(ev.queriedEntities).forEach(e => g.entities.add(e));
      const op = ev.operation || 'unknown';
      g.operations[op] = (g.operations[op] || 0) + 1;
    } else {
      unattr.apiEvents.push(ev);
      splitEntities(ev.queriedEntities).forEach(e => unattr.entities.add(e));
    }
  }

  const groupList = Object.keys(TRACKED_ECAS)
    .filter(id => groups.has(id))
    .map(id => {
      const g = groups.get(id);
      const sessions = [...g.sessions.values()];
      return {
        ecaId: g.ecaId, label: g.label, appName: g.appName,
        sessions, sessionCount: sessions.length,
        apiEvents: g.apiEvents, apiCount: g.apiEvents.length,
        distinctEntities: [...g.entities], operations: g.operations,
      };
    });

  const attributed = groupList.reduce((s, g) => s + g.apiCount, 0);
  const sessions   = groupList.reduce((s, g) => s + g.sessionCount, 0);

  return {
    window,
    activeConnection,
    trackedEcas: trackedEcaSummary(),
    groups: groupList,
    unattributed: {
      apiEvents: unattr.apiEvents,
      apiCount: unattr.apiEvents.length,
      distinctEntities: [...unattr.entities],
    },
    totals: {
      loginEvents: rawLoginCount,
      apiEvents: apiEvents.length,
      attributed,
      unattributed: unattr.apiEvents.length,
      sessions,
    },
    storesEmpty: (rawLoginCount + apiEvents.length) === 0,
  };
}

/** One-shot correlation over fixed windows. */
async function correlateEcaTraffic({ apiSinceIso, loginSinceIso, apiLimit = 200, loginLimit = 120, window }) {
  const logins = await fetchEvents({ types: ['LoginEvent', 'LoginAsEvent'], sinceIso: loginSinceIso, perTypeLimit: loginLimit });
  const index = newEcaIndex();
  indexEcaLogins(index, logins);
  const apiEvents = await fetchEvents({ types: ['ApiEvent'], sinceIso: apiSinceIso, perTypeLimit: apiLimit });
  return buildTraceResult({ index, apiEvents, rawLoginCount: logins.length, window });
}

/** Resolve the api window + (wider) login-lookback window from request params. */
function ecaTraceWindow(query) {
  const hours = Math.min(Math.max(parseInt(query.hours || '6', 10) || 6, 1), 720);
  const reqLookback = parseInt(query.loginLookbackHours || String(ECA_LOGIN_LOOKBACK_HOURS), 10) || ECA_LOGIN_LOOKBACK_HOURS;
  const loginLookbackHours = Math.max(reqLookback, hours);   // logins must span >= the api window
  const now = Date.now();
  return {
    hours, loginLookbackHours,
    apiSinceIso:   new Date(now - hours * 3600 * 1000).toISOString(),
    loginSinceIso: new Date(now - loginLookbackHours * 3600 * 1000).toISOString(),
  };
}

// One-shot pull (backfill / manual refresh).
app.get('/api/eca-trace', requireAuth, async (req, res) => {
  const w = ecaTraceWindow(req.query);
  try {
    const result = await correlateEcaTraffic({
      apiSinceIso: w.apiSinceIso, loginSinceIso: w.loginSinceIso,
      window: { apiSinceIso: w.apiSinceIso, loginSinceIso: w.loginSinceIso, hours: w.hours, loginLookbackHours: w.loginLookbackHours },
    });
    res.json(result);
  } catch (err) {
    console.error('[/api/eca-trace] error:', err.message);
    if (err.code === 'NOT_AUTHENTICATED') return res.status(401).json({ error: 'NOT_AUTHENTICATED', loginUrl: '/oauth/login' });
    res.status(500).json({ error: err.message });
  }
});

// Live SSE stream. Maintains a session index that GROWS across polls and
// re-attributes ApiEvents each poll, so late-arriving logins pull previously
// unattributed rows into their group. Emits a full TraceResult snapshot on change.
app.get('/api/eca-trace/stream', requireAuth, async (req, res) => {
  const w = ecaTraceWindow(req.query);

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Connection-scoped state — none of it resets between polls.
  const index = newEcaIndex();
  const seenApi = new Set();
  const allApi = [];             // every ApiEvent seen, re-attributed each build
  let rawLoginCount = 0;
  let loginWatermark = w.loginSinceIso;
  let apiWatermark   = w.apiSinceIso;
  let lastSnapshot = '';
  let closed = false;
  let timer = null;

  const window = { apiSinceIso: w.apiSinceIso, loginSinceIso: w.loginSinceIso, hours: w.hours, loginLookbackHours: w.loginLookbackHours };
  send('status', { message: 'connected', activeConnection, pollMs: EVENTS_POLL_MS });

  async function poll() {
    if (closed) return;
    try {
      // 1) New logins → enlarge the index (this also re-attributes on rebuild).
      const logins = await fetchEvents({ types: ['LoginEvent', 'LoginAsEvent'], sinceIso: loginWatermark, perTypeLimit: 120 });
      const freshLogins = logins.filter(l => l.eventDate && l.eventDate > loginWatermark);
      rawLoginCount += freshLogins.length;
      indexEcaLogins(index, freshLogins);
      for (const l of freshLogins) { if (l.eventDate > loginWatermark) loginWatermark = l.eventDate; }

      // 2) New ApiEvents (skip already-seen), accumulate for re-attribution.
      const api = await fetchEvents({ types: ['ApiEvent'], sinceIso: apiWatermark, perTypeLimit: 200 });
      const freshApi = api.filter(e => !seenApi.has(e.id));
      for (const e of freshApi) {
        seenApi.add(e.id);
        allApi.push(e);
        if (e.eventDate && e.eventDate > apiWatermark) apiWatermark = e.eventDate;
      }
      if (seenApi.size > 5000) { seenApi.clear(); allApi.forEach(e => seenApi.add(e.id)); }

      // 3) Rebuild the full snapshot; emit only if it changed.
      const result = buildTraceResult({ index, apiEvents: allApi, rawLoginCount, window });
      const snapshot = JSON.stringify(result);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        send('trace', result);
      } else {
        send('heartbeat', { at: apiWatermark, activeConnection });
      }
    } catch (err) {
      send('error', { message: err.message, code: err.code || null });
    }
  }

  await poll();
  timer = setInterval(poll, EVENTS_POLL_MS);

  req.on('close', () => { closed = true; if (timer) clearInterval(timer); try { res.end(); } catch { /**/ } });
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
  const externalDesc = GW_URL ? `Gateway → ${GW_URL}`
    : bedrockGwEnabled() ? `Bedrock gateway → ${BEDROCK_GW_URL} (${BEDROCK_GW_MODEL}) · token synced from settings.json`
    : anthropic ? 'Anthropic Claude (direct)' : 'not configured';
  const llmDesc = llmProvider === 'models-api'
    ? `Salesforce Models API (${SF_MODELS_API_MODEL})${isModelsAuthenticated() ? '' : ' — awaiting ECA auth'} · external: ${externalDesc}`
    : externalLlmEnabled() ? externalDesc : 'fallback (no LLM configured)';
  console.log(`  AI / Chat                 →  provider=${llmProvider} · ${llmDesc}\n`);
});
