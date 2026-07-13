import { useState, useEffect, useRef } from 'react';
import EcaTraceLegend from './EcaTraceLegend.jsx';
import EcaGroup from './EcaGroup.jsx';
import EcaUnattributed from './EcaUnattributed.jsx';

// ECA Trace — attributes otherwise-untraceable ApiEvents to a specific External
// Client App by correlating on session identifiers. Mirrors EventMonitor's SSE
// plumbing, but the stream carries a full aggregate snapshot (TraceResult) rather
// than a ring buffer of rows, so the client just replaces state on each 'trace'.

const API_HOURS = 6;

export default function EcaTrace({ activeConnection }) {
  const [meta, setMeta]     = useState(null);
  const [trace, setTrace]   = useState(null);
  const [status, setStatus] = useState('connecting');
  const [live, setLive]     = useState(true);
  const [error, setError]   = useState(null);

  const esRef = useRef(null);

  // Load static metadata (tracked ECAs + masked client ids) once.
  useEffect(() => {
    fetch('/api/events/meta')
      .then(r => r.json())
      .then(setMeta)
      .catch(() => setError('Could not load event metadata'));
  }, []);

  // Open / re-open the SSE stream whenever the live toggle changes.
  useEffect(() => {
    if (!meta || !live) {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (!live) setStatus('paused');
      return;
    }

    setStatus('connecting');
    const params = new URLSearchParams({ hours: String(API_HOURS) });
    const es = new EventSource(`/api/eca-trace/stream?${params}`);
    esRef.current = es;

    es.addEventListener('status', () => setStatus('live'));
    es.addEventListener('heartbeat', () => setStatus('live'));
    es.addEventListener('trace', (ev) => {
      setStatus('live');
      try { setTrace(JSON.parse(ev.data)); } catch { /* ignore malformed */ }
    });
    es.addEventListener('error', (ev) => {
      try { const d = JSON.parse(ev.data); if (d?.message) setError(d.message); } catch { /* transport */ }
      setStatus('reconnecting');
    });

    return () => { es.close(); if (esRef.current === es) esRef.current = null; };
  }, [meta, live]);

  async function refresh() {
    setError(null);
    try {
      const res = await fetch(`/api/eca-trace?hours=${API_HOURS}`);
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
      setTrace(await res.json());
    } catch (err) {
      setError(err.message);
    }
  }

  const groups = trace?.groups ?? [];
  const unattributed = trace?.unattributed;

  return (
    <div className="eca">
      <div className="evmon-main">
        {/* Header / controls (reuses Event Monitor styling) */}
        <div className="evmon-head">
          <div className="evmon-head-title">
            <div className="evmon-title-row">
              <h1 className="evmon-title">ECA Trace</h1>
              <span className={`evmon-status evmon-status--${status}`}>
                <span className="evmon-status-dot" />
                {status === 'live' ? 'STREAMING' : status.toUpperCase()}
              </span>
            </div>
            <p className="evmon-subtitle">
              Attributing otherwise-untraceable <code>ApiEvent</code>s to a specific External Client App by
              correlating on session identifiers — closing the gap the Event Monitor exposes.
            </p>
          </div>
          <div className="evmon-head-actions">
            <button
              className={`evmon-btn ${live ? 'evmon-btn--live' : ''}`}
              onClick={() => setLive(l => !l)}
              title={live ? 'Pause the live stream' : 'Resume the live stream'}
            >
              {live ? (
                <><svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="2" width="3" height="8" rx="1"/><rect x="7" y="2" width="3" height="8" rx="1"/></svg> Pause</>
              ) : (
                <><svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2l7 4-7 4V2z"/></svg> Resume</>
              )}
            </button>
            <button className="evmon-btn evmon-btn--ghost" onClick={refresh} title="Re-run the correlation now">Refresh</button>
          </div>
        </div>

        {error && <div className="evmon-error">{error}</div>}

        {/* Groups + the unattributed gap bucket */}
        <div className="eca-groups">
          {!trace ? (
            <div className="evmon-empty"><span className="spinner-sm" /> Correlating session activity…</div>
          ) : trace.storesEmpty ? (
            <div className="evmon-empty">
              No events captured — enable <strong>Real-Time Event Monitoring</strong> storage for this org.
            </div>
          ) : (
            <>
              {groups.map(g => <EcaGroup key={g.ecaId} group={g} />)}
              {unattributed && unattributed.apiCount > 0 && <EcaUnattributed bucket={unattributed} />}
              {groups.length === 0 && unattributed?.apiCount === 0 && (
                <div className="evmon-empty">
                  Events captured, but none matched a tracked ECA session yet. Generate MCP traffic and refresh.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <EcaTraceLegend
        trace={trace}
        trackedEcas={meta?.trackedEcas ?? trace?.trackedEcas ?? []}
        appClientIds={meta?.appClientIds}
      />
    </div>
  );
}
