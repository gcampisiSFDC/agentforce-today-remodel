// One captured ECA login session. Shows the masked session key, the user, and
// when the session started — the anchor each attributed ApiEvent joins back to.

function maskKey(k) {
  if (!k) return '—';
  return k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : k;
}

function clockTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function EcaSessionRow({ session }) {
  const key = session.sessionKey || session.loginHistoryId || session.loginKey;
  return (
    <div className="eca-session">
      <code className="eca-session-key" title={key ?? ''}>{maskKey(key)}</code>
      <span className="eca-session-user" title={session.username ?? ''}>
        {session.username ? session.username.split('@')[0] : '—'}
      </span>
      <span className="eca-session-meta">
        {session.loginType && <span>{session.loginType}</span>}
        {session.sourceIp && <span>· {session.sourceIp}</span>}
        {session.loginAt && <span>· {clockTime(session.loginAt)}</span>}
      </span>
    </div>
  );
}
