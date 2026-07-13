// Side rail explaining how each connection type maps to Event Monitoring
// visibility, doubling as a live filter. Clicking a connection filters the feed;
// the "untraceable" callout surfaces the core lesson of the app.

export default function ConnectionLegend({ connections, counts = {}, total = 0, untraceable = 0, active, onSelect, appClientIds }) {
  return (
    <aside className="evleg">
      <div className="evleg-section">
        <div className="evleg-label">CONNECTION TYPES</div>
        <p className="evleg-hint">
          Each connection the Agentforce Today app uses appears under a different
          <code> Application </code> in Event Monitoring. Click to filter the feed.
        </p>

        <button
          className={`evleg-item ${!active ? 'evleg-item--active' : ''}`}
          onClick={() => onSelect(null)}
        >
          <span className="evleg-item-main">
            <span className="evleg-dot evleg-dot--all" />
            <span className="evleg-item-name">All connections</span>
          </span>
          <span className="evleg-count">{total}</span>
        </button>

        {connections.map(c => (
          <button
            key={c.id}
            className={`evleg-item evleg-item--conn-${c.id} ${active === c.id ? 'evleg-item--active' : ''}`}
            onClick={() => onSelect(active === c.id ? null : c.id)}
          >
            <span className="evleg-item-main">
              <span className={`evleg-dot evleg-dot--${c.id}`} />
              <span className="evleg-item-text">
                <span className="evleg-item-name">{c.label}</span>
                <span className="evleg-item-sub">{c.sublabel}</span>
              </span>
            </span>
            <span className="evleg-item-right">
              <span className="evleg-count">{counts[c.id] || 0}</span>
              {c.tracesToApp === false && <span className="evleg-flag" title="API activity from this connection has no ConnectedAppId">gap</span>}
            </span>
          </button>
        ))}
      </div>

      {/* Observability callout — the point of the whole exercise */}
      <div className="evleg-callout">
        <div className="evleg-callout-head">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.5l6 10.5h-12l6-10.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M7.5 6v3M7.5 10.5v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>The observability gap</span>
        </div>
        <p className="evleg-callout-body">
          <strong>{untraceable}</strong> API event{untraceable === 1 ? '' : 's'} in view carry
          no <code>ConnectedAppId</code>. MCP- and CLI-routed queries land in the audit
          trail as <em>Application = "N/A"</em> — you can see the query happened, but not
          which connected app made it. <strong>LoginEvent</strong> is the reliable
          discriminator; <strong>ApiEvent</strong> is not.
        </p>
        {appClientIds && (appClientIds.mcp || appClientIds.models) && (
          <div className="evleg-ids">
            {appClientIds.mcp    && <div><span>MCP ECA</span><code>{appClientIds.mcp}</code></div>}
            {appClientIds.models && <div><span>Models ECA</span><code>{appClientIds.models}</code></div>}
          </div>
        )}
      </div>
    </aside>
  );
}
