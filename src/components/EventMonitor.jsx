import { useState, useEffect, useRef, useCallback } from 'react';
import EventRow from './events/EventRow.jsx';
import ConnectionLegend from './events/ConnectionLegend.jsx';

// Live Event Monitoring stream. Mirrors the AppExchange "Event Streaming" app:
// subscribe to Real-Time Event Monitoring objects, render each event as it
// arrives, and — the point of this build — colour-code every event by the
// *connection type* that produced it, so you can watch how the Agentforce Today
// app's MCP / Models API / CLI / browser connections show up (or don't) in the
// audit trail.

const MAX_EVENTS = 400;   // ring buffer — keep the newest N in the DOM

export default function EventMonitor({ activeConnection }) {
  const [meta, setMeta]         = useState(null);
  const [events, setEvents]     = useState([]);
  const [enabled, setEnabled]   = useState({});   // type id -> bool
  const [connFilter, setConnFilter] = useState(null); // connection id or null (all)
  const [status, setStatus]     = useState('connecting');
  const [live, setLive]         = useState(true);
  const [error, setError]       = useState(null);

  const esRef     = useRef(null);
  const seenRef   = useRef(new Set());
  const feedRef   = useRef(null);
  const pinnedRef = useRef(true);  // auto-scroll only when pinned to top

  // Load static metadata (types + connection legend) once.
  useEffect(() => {
    fetch('/api/events/meta')
      .then(r => r.json())
      .then(m => {
        setMeta(m);
        setEnabled(Object.fromEntries(m.types.map(t => [t.id, true])));
      })
      .catch(() => setError('Could not load event metadata'));
  }, []);

  const enabledTypes = Object.entries(enabled).filter(([, on]) => on).map(([id]) => id);
  const enabledKey = enabledTypes.slice().sort().join(',');

  const ingest = useCallback((incoming) => {
    setEvents(prev => {
      const fresh = incoming.filter(e => !seenRef.current.has(e.id));
      if (!fresh.length) return prev;
      fresh.forEach(e => seenRef.current.add(e.id));
      // Newest first in the array; cap the ring buffer.
      const merged = [...fresh.reverse(), ...prev].slice(0, MAX_EVENTS);
      return merged;
    });
  }, []);

  // Open / re-open the SSE stream whenever the type filter or live toggle changes.
  useEffect(() => {
    if (!meta || !live) {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      if (!live) setStatus('paused');
      return;
    }
    if (!enabledTypes.length) { setStatus('idle'); return; }

    setStatus('connecting');
    const params = new URLSearchParams({ types: enabledKey, hours: '6' });
    const es = new EventSource(`/api/events/stream?${params}`);
    esRef.current = es;

    es.addEventListener('status', () => setStatus('live'));
    es.addEventListener('heartbeat', () => setStatus('live'));
    es.addEventListener('events', (ev) => {
      setStatus('live');
      try {
        const { events: batch } = JSON.parse(ev.data);
        ingest(batch);
      } catch { /* ignore malformed */ }
    });
    es.addEventListener('error', (ev) => {
      // Distinguish server-sent error events from transport drops.
      try { const d = JSON.parse(ev.data); if (d?.message) setError(d.message); } catch { /* transport */ }
      setStatus('reconnecting');
    });

    return () => { es.close(); if (esRef.current === es) esRef.current = null; };
  }, [meta, live, enabledKey, ingest]);

  // Auto-scroll to top when new events land, but only if the user is pinned there.
  useEffect(() => {
    if (pinnedRef.current && feedRef.current) feedRef.current.scrollTop = 0;
  }, [events]);

  function onFeedScroll(e) {
    pinnedRef.current = e.target.scrollTop < 24;
  }

  function toggleType(id) {
    setEnabled(prev => ({ ...prev, [id]: !prev[id] }));
  }

  function clearFeed() {
    seenRef.current.clear();
    setEvents([]);
  }

  // Client-side connection filter (server streams all connection types).
  const visible = connFilter ? events.filter(e => e.connection === connFilter) : events;

  // Live counts by connection, for the legend badges.
  const counts = events.reduce((acc, e) => { acc[e.connection] = (acc[e.connection] || 0) + 1; return acc; }, {});
  const untraceable = events.filter(e => e.type === 'ApiEvent' && e.appTraceable === false).length;

  return (
    <div className="evmon">
      <div className="evmon-main">
        {/* Header / controls */}
        <div className="evmon-head">
          <div className="evmon-head-title">
            <div className="evmon-title-row">
              <h1 className="evmon-title">Event Monitor</h1>
              <span className={`evmon-status evmon-status--${status}`}>
                <span className="evmon-status-dot" />
                {status === 'live' ? 'STREAMING' : status.toUpperCase()}
              </span>
            </div>
            <p className="evmon-subtitle">
              Real-Time Event Monitoring for <strong>{activeConnection ?? 'this org'}</strong> — every event
              colour-coded by the connection type that produced it.
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
            <button className="evmon-btn evmon-btn--ghost" onClick={clearFeed} title="Clear the feed">Clear</button>
          </div>
        </div>

        {/* Type filter chips */}
        <div className="evmon-filters">
          {meta?.types.map(t => (
            <button
              key={t.id}
              className={`evmon-chip ${enabled[t.id] ? 'evmon-chip--on' : ''} evmon-chip--type-${t.id}`}
              onClick={() => toggleType(t.id)}
            >
              <span className="evmon-chip-dot" />
              {t.label}
            </button>
          ))}
        </div>

        {error && <div className="evmon-error">{error}</div>}

        {/* Live feed */}
        <div className="evmon-feed" ref={feedRef} onScroll={onFeedScroll}>
          {visible.length === 0 ? (
            <div className="evmon-empty">
              {status === 'connecting'
                ? <><span className="spinner-sm" /> Subscribing to event stream…</>
                : connFilter
                  ? <>No <strong>{meta?.connections.find(c => c.id === connFilter)?.label}</strong> events yet. Trigger some activity in the Agentforce Today app.</>
                  : <>Waiting for events. Use the Agentforce Today dashboard or chat to generate activity, then watch it appear here.</>}
            </div>
          ) : (
            visible.map(ev => <EventRow key={ev.id} ev={ev} />)
          )}
        </div>
      </div>

      {/* Side rail: connection legend + observability callout */}
      <ConnectionLegend
        connections={meta?.connections ?? []}
        counts={counts}
        total={events.length}
        untraceable={untraceable}
        active={connFilter}
        onSelect={setConnFilter}
        appClientIds={meta?.appClientIds}
      />
    </div>
  );
}
