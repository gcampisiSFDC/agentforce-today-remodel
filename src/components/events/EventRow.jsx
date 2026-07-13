// One row in the live event feed. The connection type drives the left accent
// bar and badge colour; ApiEvents that can't be traced back to a connected app
// get an "untraceable" marker — the observability gap this app demonstrates.

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function clockTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function EventRow({ ev }) {
  const detail = buildDetail(ev);

  return (
    <div className={`evrow evrow--conn-${ev.connection} evrow--type-${ev.type}`}>
      <span className="evrow-accent" />
      <div className="evrow-time">
        <span className="evrow-clock">{clockTime(ev.eventDate)}</span>
        <span className="evrow-ago">{timeAgo(ev.eventDate)}</span>
      </div>

      <div className="evrow-body">
        <div className="evrow-line1">
          <span className={`evrow-type evrow-type--${ev.type}`}>{ev.typeLabel}</span>
          <span className={`evrow-conn evrow-conn--${ev.connection}`}>
            <span className="evrow-conn-dot" />
            {ev.connectionLabel}
          </span>
          {ev.type === 'ApiEvent' && (
            ev.appTraceable
              ? <span className="evrow-trace evrow-trace--ok" title="This API call is attributable to a connected app">traceable</span>
              : <span className="evrow-trace evrow-trace--gap" title="No ConnectedAppId — this API call cannot be traced back to the app that made it">untraceable</span>
          )}
          {ev.matchedKey && (
            <span className={`evrow-prov evrow-prov--${ev.matchedKey}`} title={`Attributed to this ECA by matching ${ev.matchedKey === 'session' ? 'SessionKey' : ev.matchedKey === 'history' ? 'LoginHistoryId' : 'LoginKey'}`}>
              {ev.matchedKey}
            </span>
          )}
        </div>
        <div className="evrow-line2">{detail}</div>
      </div>

      <div className="evrow-user" title={ev.username ?? ''}>
        {shortUser(ev.username)}
      </div>
    </div>
  );
}

function shortUser(u) {
  if (!u) return '—';
  return u.split('@')[0];
}

// Compose a human one-liner from whichever fields the event type populated.
function buildDetail(ev) {
  switch (ev.type) {
    case 'LoginEvent':
      return (
        <>
          <strong>{ev.loginType || 'Login'}</strong>
          {ev.application && ev.application !== 'N/A' && <> via <em>{ev.application}</em></>}
          {ev.status && <> · {ev.status}</>}
          {ev.platform && ev.platform !== 'Unknown' && <> · {ev.platform}</>}
        </>
      );
    case 'LoginAsEvent':
      return <>Login-as into <strong>{ev.delegatedUser || 'user'}</strong>{ev.application && <> via <em>{ev.application}</em></>}</>;
    case 'LogoutEvent':
      return <>Session ended{ev.sourceIp ? <> · {ev.sourceIp}</> : null}</>;
    case 'ApiEvent':
      return (
        <>
          <strong>{ev.operation || 'API call'}</strong>
          {ev.queriedEntities && <> on <em>{ev.queriedEntities}</em></>}
          {ev.apiType && <> · {ev.apiType}</>}
          {ev.rowsReturned != null && <> · {ev.rowsReturned} rows</>}
        </>
      );
    case 'ReportEvent':
      return <>Report run{ev.queriedEntities && <> · <em>{ev.queriedEntities}</em></>}</>;
    case 'LightningUriEvent':
      return <><strong>{ev.operation || 'Page view'}</strong>{ev.pageUrl && <> · {ev.pageUrl}</>}</>;
    default:
      return ev.operation || ev.application || '—';
  }
}
