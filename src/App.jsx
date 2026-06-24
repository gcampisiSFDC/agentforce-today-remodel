import { useState, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import DashboardPanel from './components/DashboardPanel.jsx';
import ActionPanel from './components/ActionPanel.jsx';
import AuthGate from './components/AuthGate.jsx';
import ForecastChat from './components/ForecastChat.jsx';

const MODELS = [
  { id: 'claude-opus-4-7',             label: 'Claude Opus 4.7',      provider: 'Anthropic', available: true },
  { id: 'claude-sonnet-4-6',           label: 'Claude Sonnet 4.6',    provider: 'Anthropic', available: true },
  { id: 'claude-sonnet-4-5-20250929',  label: 'Claude Sonnet 4.5',    provider: 'Anthropic', available: true },
  { id: 'claude-haiku-4-5-20251001',   label: 'Claude Haiku 4.5',     provider: 'Anthropic', available: true },
  { id: 'gpt-5',                        label: 'GPT-5',                provider: 'OpenAI',    available: true },
  { id: 'gpt-5-mini',                   label: 'GPT-5 Mini',           provider: 'OpenAI',    available: true },
  { id: 'gpt-4o',                       label: 'GPT-4o',               provider: 'OpenAI',    available: true },
  { id: 'gemini-3.1-pro-preview',       label: 'Gemini 3.1 Pro',       provider: 'Google',    available: true },
  { id: 'gemini-2.5-pro',               label: 'Gemini 2.5 Pro',       provider: 'Google',    available: true },
  { id: 'gemini-2.5-flash',             label: 'Gemini 2.5 Flash',     provider: 'Google',    available: true },
];

export default function App() {
  const [auth, setAuth]               = useState({ authenticated: false, loginUrl: '/oauth/login', checked: false });
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [model, setModel]             = useState('claude-sonnet-4-5-20250929');
  const [modelOpen, setModelOpen]     = useState(false);
  const [activeBriefing, setActiveBriefing] = useState(null);
  const [chatOpen,       setChatOpen]       = useState(false);
  const [llmProvider, setLlmProvider] = useState('external');
  const [trustLayer, setTrustLayer]   = useState(false);
  const [connections, setConnections] = useState([]);
  const [activeConnection, setActiveConnection] = useState(null);
  const [connOpen, setConnOpen]       = useState(false);

  // Check auth status on mount and after OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authErr = params.get('auth_error');
    if (authErr) {
      setError(`Authentication failed: ${authErr}`);
      window.history.replaceState({}, '', '/');
    }
    checkAuth();
    loadConnections();
  }, []);

  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/status');
      const d   = await res.json();
      setAuth({ ...d, checked: true });
      if (d.activeConnection) setActiveConnection(d.activeConnection);
      if (d.authenticated) loadToday(model);
    } catch {
      setAuth(a => ({ ...a, checked: true }));
    }
  }

  async function loadConnections() {
    try {
      const res = await fetch('/api/connections');
      const d   = await res.json();
      setConnections(d.connections ?? []);
      setActiveConnection(d.active);
    } catch { /* connection list is best-effort */ }
  }

  async function handleConnectionChange(c) {
    setConnOpen(false);
    if (!c.available || c.id === activeConnection) return;
    try {
      const res = await fetch('/api/connections/use', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id }),
      });
      const result = await res.json();
      if (result.ok) {
        setActiveConnection(result.active);
        setConnections(result.connections ?? connections);
        loadToday(model, true);  // re-fetch from the new source
      } else if (result.needsAuth) {
        window.location.href = result.loginUrl;  // OAuth connect for this connection
      } else {
        setError(result.error || 'Could not switch connection');
      }
    } catch (err) {
      setError(`Failed to switch connection: ${err.message}`);
    }
  }

  const loadToday = useCallback(async (selectedModel, force = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = `/api/today?model=${encodeURIComponent(selectedModel)}${force ? '&force=true' : ''}`;
      const res = await fetch(url);
      if (res.status === 401) { setAuth(a => ({ ...a, authenticated: false })); return; }
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      const result = await res.json();
      setData(result);
      // Update LLM provider state from server
      if (result.llmProvider !== undefined) {
        setLlmProvider(result.llmProvider);
        setTrustLayer(result.trustLayer ?? false);
      }
      if (result.activeConnection) setActiveConnection(result.activeConnection);
      if (result._meta) {
        console.log(`[Dashboard] Loaded in ${result._meta.responseTimeMs}ms${result._meta.cached ? ' (cached)' : ''}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleModelChange(m) {
    if (!m.available) return;
    setModel(m.id);
    setModelOpen(false);
    loadToday(m.id, true);  // Force refresh on model change
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuth({ authenticated: false, loginUrl: '/oauth/login', checked: true });
    setData(null);
  }

  async function handleProviderToggle() {
    const newProvider = llmProvider === 'external' ? 'models-api' : 'external';
    const endpoint = newProvider === 'models-api' ? '/api/llm/use-models-api' : '/api/llm/use-external';
    
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const result = await res.json();
      if (result.ok) {
        setLlmProvider(result.provider);
        setTrustLayer(result.trustLayer);
        console.log(`[Provider] Switched to ${result.provider} (Trust Layer: ${result.trustLayer ? 'ON' : 'OFF'})`);
      } else if (result.needsAuth) {
        console.log('[Provider] Models API needs auth, redirecting...');
        window.location.href = result.modelsLoginUrl;
      }
    } catch (err) {
      console.error('Failed to toggle LLM provider:', err);
    }
  }

  if (!auth.checked) return <div className="splash"><div className="spinner" /></div>;

  if (!auth.authenticated) {
    return <AuthGate loginUrl={auth.loginUrl} error={error} />;
  }

  return (
    <div className="app" onClick={() => { if (modelOpen) setModelOpen(false); if (connOpen) setConnOpen(false); }}>
      <ForecastChat
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        model={model}
      />
      <Header
        model={model}
        models={MODELS}
        modelOpen={modelOpen}
        onModelToggle={(e) => { e.stopPropagation(); setModelOpen(o => !o); }}
        onModelChange={handleModelChange}
        onRefresh={() => loadToday(model, true)}
        onLogout={handleLogout}
        loading={loading}
        aiEnabled={data?.aiEnabled}
        llmProvider={llmProvider}
        trustLayer={trustLayer}
        onProviderToggle={handleProviderToggle}
        connections={connections}
        activeConnection={activeConnection}
        connOpen={connOpen}
        onConnToggle={(e) => { e.stopPropagation(); setConnOpen(o => !o); }}
        onConnChange={handleConnectionChange}
      />
      <div className="layout">
        <DashboardPanel
          date={data?.date}
          score={data?.score}
          kpis={data?.kpis ?? {}}
          charts={data?.charts ?? {}}
          briefings={data?.briefings ?? []}
          loading={loading}
          activeBriefing={activeBriefing}
          onBriefingClick={setActiveBriefing}
        />
        <ActionPanel
          actions={data?.actions ?? []}
          relatedRecords={data?.relatedRecords ?? []}
          loading={loading}
          activeBriefing={activeBriefing}
          onOpenChat={() => setChatOpen(true)}
        />
      </div>
    </div>
  );
}
