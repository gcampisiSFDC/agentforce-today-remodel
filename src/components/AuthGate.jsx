export default function AuthGate({ loginUrl, error }) {
  return (
    <div className="auth-gate">
      <div className="auth-box">
        <div className="auth-logo">
          <div className="auth-logo-mark">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <path d="M11 2L18.5 16H3.5L11 2Z" fill="white" opacity=".9"/>
              <circle cx="11" cy="12" r="3.5" fill="white"/>
            </svg>
          </div>
          <div className="auth-logo-text">
            <span className="auth-logo-name">Agentforce</span>
            <span className="auth-logo-today">Today</span>
          </div>
        </div>

        <p className="auth-subtitle">
          Connect your Salesforce org to receive AI-powered daily sales briefings.
        </p>

        {error && (
          <div className="auth-error">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M7 4.5v3M7 9.5v.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            {error}
          </div>
        )}

        <a href={loginUrl} className="auth-connect-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8S4.41 14.5 8 14.5 14.5 11.59 14.5 8 11.59 1.5 8 1.5z" stroke="white" strokeWidth="1.2"/>
            <path d="M5.5 8C5.5 6.07 6.35 4.5 8 4.5s2.5 1.57 2.5 3.5S9.65 11.5 8 11.5 5.5 9.93 5.5 8z" fill="white" opacity=".7"/>
          </svg>
          Connect to Salesforce
        </a>

        <p className="auth-hint">OAuth 2.0 PKCE · credentials never stored on this server</p>
      </div>
    </div>
  );
}
