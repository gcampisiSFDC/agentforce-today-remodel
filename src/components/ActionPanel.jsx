const URGENCY = {
  HIGH:   { color: '#c75b2e', bg: '#fdf5f0', label: 'High' },
  MEDIUM: { color: '#8b7355', bg: '#f5f0ea', label: 'Medium' },
  LOW:    { color: '#9a938a', bg: '#f5f2ed', label: 'Low' },
};

export default function ActionPanel({ actions, relatedRecords, loading, onOpenChat }) {
  if (loading && actions.length === 0) {
    return (
      <div className="action-panel">
        <div className="panel-section-label">What to do</div>
        {[1,2,3].map(i => (
          <div key={i} className="action-item">
            <div className="sk-num" />
            <div className="sk-lines">
              <div className="sk-line sk-line--long" />
              <div className="sk-line sk-line--med" style={{ marginTop: 6 }} />
            </div>
          </div>
        ))}
        <div className="panel-divider" />
        <div className="panel-section-label">Related in Salesforce</div>
        {[1,2,3].map(i => (
          <div key={i} className="related-card">
            <div className="sk-line sk-line--long" />
            <div className="sk-line sk-line--med" style={{ marginTop: 8 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="action-panel">

      {/* What To Do */}
      <div className="panel-section-label">What to do</div>

      {actions.length === 0 ? (
        <p className="panel-empty">Pipeline is healthy — no urgent actions.</p>
      ) : (
        <div className="action-list">
          {actions.map((action, idx) => {
            const urg = URGENCY[action.urgency] ?? URGENCY.LOW;
            return (
              <div key={action.id} className="action-item">
                <div
                  className="action-num"
                  style={{ background: urg.bg, color: urg.color, borderColor: urg.color + '33' }}
                >
                  {idx + 1}
                </div>
                <div className="action-body">
                  <p className="action-text">{action.text}</p>
                  {action.opportunityName && (
                    <a className="action-link" href="#" onClick={e => e.preventDefault()}>
                      Open opportunity
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 8L8 2M8 2H4.5M8 2V5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="panel-divider" />

      {/* Related in Salesforce */}
      <div className="panel-section-label">Related in Salesforce</div>

      {relatedRecords.length === 0 ? (
        <p className="panel-empty">No related records found.</p>
      ) : (
        <div className="related-list">
          {relatedRecords.map(record => (
            <RelatedRecord key={record.id} record={record} />
          ))}
        </div>
      )}

      {relatedRecords.length > 0 && (
        <div className="panel-cta-row">
          <button className="cta-btn" onClick={onOpenChat}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 10.5h1.5L7 13l3.5-2.5H12a1 1 0 001-1V3a1 1 0 00-1-1H2a1 1 0 00-1 1v6.5a1 1 0 001 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M4.5 5.5h5M4.5 7.5h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Open forecast focus
          </button>
          <button className="cta-btn-ghost">Submit update</button>
        </div>
      )}
    </div>
  );
}

function RelatedRecord({ record }) {
  return (
    <div className="related-card">
      <div className="related-header">
        <div className="related-icon">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M2 10V4a1 1 0 011-1h7a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1z" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M4.5 6h4M4.5 8h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </div>
        <span className="related-name">{record.name}</span>
        <a className="related-ext" href="#" onClick={e => e.preventDefault()} title="Open in Salesforce">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 9.5L9.5 1.5M9.5 1.5H5M9.5 1.5V6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
      </div>

      <div className="related-meta">
        {record.stage && <span className="related-stage-pill">{record.stage}</span>}
        {record.amount && record.amount !== 'N/A' && (
          <span className="related-amount">{record.amount}</span>
        )}
        {record.closeDate && (
          <span className="related-close">Closes {formatDate(record.closeDate)}</span>
        )}
      </div>

      {record.notes && (
        <p className="related-notes">{record.notes}</p>
      )}
    </div>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}
