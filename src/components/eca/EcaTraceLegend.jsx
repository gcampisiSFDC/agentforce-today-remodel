// Side rail for ECA Trace: run totals, the observability-gap callout, the masked
// client ids of the tracked ECAs, and a config warning when the DX MCP ECA's
// Application string is generic/ambiguous (so it can't be reliably separated).

const RESERVED = new Set(['SALESFORCE CLI', 'BROWSER', 'SF MODELS', 'N/A']);

export default function EcaTraceLegend({ trace, trackedEcas = [], appClientIds }) {
  const t = trace?.totals;
  const dxEca = trackedEcas.find(e => e.id === 'dx-mcp');
  const dxAmbiguous = dxEca && RESERVED.has((dxEca.appName || '').trim().toUpperCase());

  return (
    <aside className="evleg">
      <div className="evleg-section">
        <div className="evleg-label">TRACE TOTALS</div>
        <p className="evleg-hint">
          ApiEvents attributed to a tracked ECA by matching <code>SessionKey</code> →
          <code> LoginHistoryId</code> → <code>LoginKey</code> against captured logins.
        </p>

        <div className="eca-totals">
          <Stat label="Sessions"     value={t?.sessions} />
          <Stat label="API events"   value={t?.apiEvents} />
          <Stat label="Attributed"   value={t?.attributed} accent="ok" />
          <Stat label="Unattributed" value={t?.unattributed} accent="gap" />
        </div>
      </div>

      {/* Tracked ECAs + masked client ids */}
      <div className="evleg-section">
        <div className="evleg-label">TRACKED ECAs</div>
        {trackedEcas.map(e => (
          <div key={e.id} className="evleg-ids">
            <div>
              <span><span className={`evleg-dot evleg-dot--${e.id}`} /> {e.label}</span>
              <code>{e.clientIdMasked ?? 'no client id'}</code>
            </div>
            <div className="eca-eca-app">
              <span>Application</span><code>{e.appName}</code>
            </div>
          </div>
        ))}
      </div>

      {dxAmbiguous && (
        <div className="evleg-callout evleg-callout--warn">
          <div className="evleg-callout-head">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 1.5l6 10.5h-12l6-10.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M7.5 6v3M7.5 10.5v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span>Ambiguous DX MCP name</span>
          </div>
          <p className="evleg-callout-body">
            The DX MCP ECA reports a generic <em>Application</em> ({dxEca.appName}) that collides with other
            traffic, so its calls can't be reliably separated. Give the DX ECA a unique Application string and
            set <code>SF_DXMCP_APP_NAME</code> to match.
          </p>
        </div>
      )}

      {/* Observability callout — the point of the exercise */}
      <div className="evleg-callout">
        <div className="evleg-callout-head">
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
            <path d="M7.5 1.5l6 10.5h-12l6-10.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
            <path d="M7.5 6v3M7.5 10.5v.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span>The observability gap</span>
        </div>
        <p className="evleg-callout-body">
          <code>ApiEvent.ConnectedAppId</code> is only stamped for classic Connected Apps. ECAs log in as
          <em> Remote Access 2.0</em>, so their API calls carry no <code>ConnectedAppId</code> — the login is
          attributable, the calls are not. This view recovers that link by joining on the
          <strong> session</strong> the calls share with the login.
        </p>
      </div>
    </aside>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`eca-stat ${accent ? `eca-stat--${accent}` : ''}`}>
      <span className="eca-stat-value">{value ?? '—'}</span>
      <span className="eca-stat-label">{label}</span>
    </div>
  );
}
