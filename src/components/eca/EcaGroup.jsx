import EventRow from '../events/EventRow.jsx';
import EcaSessionRow from './EcaSessionRow.jsx';

// Per-ECA card: header (label / appName / colour dot), aggregate stats, the
// captured sessions, and the ApiEvents attributed to this ECA.

export default function EcaGroup({ group }) {
  const { ecaId, label, appName, sessions = [], sessionCount, apiEvents = [], apiCount, distinctEntities = [], operations = {} } = group;
  const topOps = Object.entries(operations).sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <section className={`eca-group eca-group--${ecaId}`}>
      <div className="eca-group-head">
        <div className="eca-group-title">
          <span className={`evleg-dot evleg-dot--${ecaId}`} />
          <span className="eca-group-name">{label}</span>
          {appName && <code className="eca-group-app">{appName}</code>}
        </div>
        <div className="eca-group-stats">
          <span><strong>{sessionCount}</strong> session{sessionCount === 1 ? '' : 's'}</span>
          <span><strong>{apiCount}</strong> API call{apiCount === 1 ? '' : 's'}</span>
          <span><strong>{distinctEntities.length}</strong> entit{distinctEntities.length === 1 ? 'y' : 'ies'}</span>
        </div>
      </div>

      {distinctEntities.length > 0 && (
        <div className="eca-entities">
          {distinctEntities.slice(0, 12).map(e => <span key={e} className="eca-chip">{e}</span>)}
          {distinctEntities.length > 12 && <span className="eca-chip eca-chip--more">+{distinctEntities.length - 12}</span>}
        </div>
      )}

      {topOps.length > 0 && (
        <div className="eca-entities">
          {topOps.map(([op, n]) => <span key={op} className="eca-chip eca-chip--op">{op} · {n}</span>)}
        </div>
      )}

      {sessions.length > 0 && (
        <div className="eca-sessions">
          {sessions.map((s, i) => <EcaSessionRow key={s.sessionKey || s.loginHistoryId || s.loginKey || i} session={s} />)}
        </div>
      )}

      <div className="eca-group-feed">
        {apiEvents.length === 0
          ? <div className="eca-group-empty">Session captured — no attributed API calls in this window yet.</div>
          : apiEvents.map(ev => <EventRow key={ev.id} ev={ev} />)}
      </div>
    </section>
  );
}
