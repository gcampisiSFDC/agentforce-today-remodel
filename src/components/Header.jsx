import ModelSelector from './ModelSelector.jsx';
import ConnectionSelector, { TransportIcon } from './ConnectionSelector.jsx';

export default function Header({ model, models, modelOpen, onModelToggle, onModelChange, onRefresh, onLogout, loading, aiEnabled, llmProvider, trustLayer, onProviderToggle, connections, activeConnection, connOpen, onConnToggle, onConnChange, view, onViewChange }) {
  const selectedModel = models.find(m => m.id === model);
  const selectedConn = connections?.find(c => c.id === activeConnection);

  return (
    <header className="header">
      <div className="header-left">
        <div className="logo">
          <div className="logo-mark">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M9 2L15.5 14H2.5L9 2Z" fill="white" opacity=".9"/>
              <circle cx="9" cy="10" r="3" fill="white"/>
            </svg>
          </div>
          <div className="logo-text">
            <span className="logo-name">Agentforce</span>
            <span className="logo-today">Today</span>
          </div>
        </div>
        <span className="header-sep" />
        <nav className="header-tabs">
          <button
            className={`header-tab ${view === 'dashboard' ? 'header-tab--active' : ''}`}
            onClick={() => onViewChange?.('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`header-tab ${view === 'events' ? 'header-tab--active' : ''}`}
            onClick={() => onViewChange?.('events')}
          >
            <span className="header-tab-live-dot" />
            Event Monitor
          </button>
          <button
            className={`header-tab ${view === 'eca-trace' ? 'header-tab--active' : ''}`}
            onClick={() => onViewChange?.('eca-trace')}
          >
            <span className="header-tab-live-dot" />
            ECA Trace
          </button>
        </nav>
      </div>

      <div className="header-right">
        {/* LLM Provider Toggle */}
        <button 
          className={`provider-toggle ${trustLayer ? 'provider-toggle--trust' : 'provider-toggle--external'}`}
          onClick={onProviderToggle}
          title={trustLayer ? 'Using Salesforce Models API (Trust Layer active)' : 'Using Anthropic LLM Gateway (Trust Layer bypassed)'}
        >
          <TrustLayerIcon active={trustLayer} />
          <span className="provider-toggle-label">
            {trustLayer ? 'Models API' : 'Anthropic LLM GW'}
          </span>
          <span className={`provider-toggle-status ${trustLayer ? 'status--on' : 'status--off'}`}>
            {trustLayer ? '✓' : '✗'}
          </span>
        </button>

        {/* Data connection selector */}
        {connections?.length > 0 && (
          <div className="conn-trigger-wrap" onClick={onConnToggle}>
            <button className="conn-trigger" type="button" title="Switch Salesforce data connection">
              <TransportIcon transport={selectedConn?.transport ?? 'mcp'} size={13} />
              <span className="conn-trigger-label">{selectedConn?.label ?? 'Connection'}</span>
              <ChevronIcon open={connOpen} />
            </button>
            {connOpen && (
              <ConnectionSelector connections={connections} active={activeConnection} onSelect={onConnChange} />
            )}
          </div>
        )}

        <span className={`live-badge ${aiEnabled ? 'live-badge--on' : 'live-badge--off'}`}>
          <span className="live-dot" />
          {aiEnabled ? 'LIVE' : 'OFFLINE'}
        </span>

        <div className="model-trigger-wrap" onClick={onModelToggle}>
          <button className="model-trigger" type="button">
            <ProviderIcon provider={selectedModel?.provider} size={14} />
            <span className="model-trigger-label">{selectedModel?.label ?? model}</span>
            <ChevronIcon open={modelOpen} />
          </button>
          {modelOpen && (
            <ModelSelector models={models} selected={model} onSelect={onModelChange} />
          )}
        </div>

        <button className="header-btn header-btn--primary" onClick={onRefresh} disabled={loading}>
          {loading
            ? <><span className="spinner-sm" /> Refreshing…</>
            : 'Refresh'}
        </button>

        <button className="header-btn header-btn--ghost icon-only" onClick={onLogout} title="Disconnect org">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M5.5 2.5H3A1.5 1.5 0 001.5 4v7A1.5 1.5 0 003 12.5h2.5M9.5 10.5l3-3-3-3M12.5 7.5h-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </header>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ transition: 'transform .15s', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function ProviderIcon({ provider, size = 14 }) {
  const s = size;
  const icons = {
    Anthropic: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-6.652 0h3.603L17.35 20.48h-3.603L7.175 3.52z"/>
      </svg>
    ),
    Google: (
      <svg width={s} height={s} viewBox="0 0 24 24">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    ),
    OpenAI: (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.282 9.821a5.985 5.985 0 00-.516-4.91 6.046 6.046 0 00-6.51-2.9A6.065 6.065 0 004.981 4.18a5.985 5.985 0 00-3.998 2.9 6.046 6.046 0 00.743 7.097 5.98 5.98 0 00.51 4.911 6.051 6.051 0 006.515 2.9A5.985 5.985 0 0013.26 24a6.056 6.056 0 005.772-4.206 5.99 5.99 0 003.997-2.9 6.056 6.056 0 00-.747-7.073zM13.26 22.43a4.476 4.476 0 01-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 00.392-.681v-6.737l2.02 1.168a.071.071 0 01.038.052v5.583a4.504 4.504 0 01-4.494 4.494zM3.6 18.304a4.47 4.47 0 01-.535-3.014l.142.085 4.783 2.759a.771.771 0 00.78 0l5.843-3.369v2.332a.08.08 0 01-.033.062L9.74 19.95a4.5 4.5 0 01-6.14-1.646zM2.34 7.896a4.485 4.485 0 012.366-1.973V11.6a.766.766 0 00.388.677l5.815 3.354-2.02 1.168a.076.076 0 01-.071 0l-4.83-2.786A4.504 4.504 0 012.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 01.071 0l4.83 2.791a4.494 4.494 0 01-.676 8.105v-5.678a.79.79 0 00-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 00-.785 0L9.409 9.23V6.897a.066.066 0 01.028-.061l4.83-2.787a4.5 4.5 0 016.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 01-.038-.057V6.075a4.5 4.5 0 017.375-3.453l-.142.08L8.704 5.46a.795.795 0 00-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
      </svg>
    ),
  };
  return <span style={{ display:'inline-flex', alignItems:'center', flexShrink:0 }}>{icons[provider] ?? null}</span>;
}

function TrustLayerIcon({ active }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {active ? (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="currentColor" opacity="0.2"/>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="M9 12l2 2 4-4" strokeWidth="2.5"/>
        </>
      ) : (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="M9 9l6 6M15 9l-6 6" strokeWidth="2"/>
        </>
      )}
    </svg>
  );
}
