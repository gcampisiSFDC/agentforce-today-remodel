import EventRow from '../events/EventRow.jsx';

// The observability gap bucket: ApiEvents whose session didn't match any tracked
// ECA login. Expected for browser / CLI / Models traffic — a correct outcome,
// not an error — framed with the same "gap" language as the legend.

export default function EcaUnattributed({ bucket }) {
  const { apiEvents = [], apiCount, distinctEntities = [] } = bucket;

  return (
    <section className="eca-group eca-group--unattributed">
      <div className="eca-group-head">
        <div className="eca-group-title">
          <span className="evleg-dot evleg-dot--other" />
          <span className="eca-group-name">Unattributed</span>
          <code className="eca-group-app">no tracked-ECA session</code>
        </div>
        <div className="eca-group-stats">
          <span><strong>{apiCount}</strong> API call{apiCount === 1 ? '' : 's'}</span>
          <span><strong>{distinctEntities.length}</strong> entit{distinctEntities.length === 1 ? 'y' : 'ies'}</span>
        </div>
      </div>

      <p className="eca-gap-note">
        These <code>ApiEvent</code>s carry no <code>ConnectedAppId</code> and matched no tracked-ECA session —
        browser, CLI, and Models traffic land here. The query is visible; the originating app is not.
      </p>

      {distinctEntities.length > 0 && (
        <div className="eca-entities">
          {distinctEntities.slice(0, 12).map(e => <span key={e} className="eca-chip">{e}</span>)}
          {distinctEntities.length > 12 && <span className="eca-chip eca-chip--more">+{distinctEntities.length - 12}</span>}
        </div>
      )}

      <div className="eca-group-feed">
        {apiEvents.map(ev => <EventRow key={ev.id} ev={ev} />)}
      </div>
    </section>
  );
}
