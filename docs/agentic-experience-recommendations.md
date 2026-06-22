# Building Secure Agentic Experiences on Salesforce
## Recommendations & Talk Track

*Based on POC findings from the Agentforce Today implementation*

---

## Executive Summary

When building agentic AI experiences that interact with Salesforce data, security and observability aren't afterthoughts—they're architectural decisions that need to be made upfront. Our POC demonstrated that while you *can* build custom agentic applications outside the platform, doing so requires careful attention to authentication, authorization, and audit logging to achieve the same governance posture that Agentforce provides out of the box.

---

## Key Recommendations

### 1. Start with Data Access Controls

**Object-Level and Field-Level Security (OLS/FLS) are your first line of defense.**

Before connecting any agent—whether Agentforce or custom-built—audit your security model:

- **Object-Level Security**: Ensure the integration user or OAuth user can only access objects the agent legitimately needs. An agent that answers order status questions doesn't need access to Salary__c.
  
- **Field-Level Security**: Even within accessible objects, restrict sensitive fields. Your agent may need Account.Name but not Account.AnnualRevenue.

- **Sharing Rules**: Consider whether the agent should see all records or only those the end user would see. Running as an integration user with "View All" is convenient but may expose data inappropriately.

> **Talk Track**: "The agent inherits the permissions of whoever authenticates it. If you're using a single integration user, that user's profile becomes the ceiling for what every customer interaction can access. Design this intentionally."

---

### 2. Consider Agentforce for Built-In Governance

**If you're building on Salesforce, Agentforce gives you security and observability by default.**

Agentforce provides:

| Capability | What It Does | DIY Equivalent |
|------------|--------------|----------------|
| **Einstein Trust Layer** | Toxicity detection, PII masking, prompt defense | You'd need to build or buy this |
| **Session Tracing (STDM)** | Full audit trail of every LLM call, topic routing, action execution | Custom logging + Data Cloud |
| **Grounding in CRM** | Secure retrieval with automatic FLS/OLS enforcement | Manual query + permission checks |
| **Action Guardrails** | Declarative limits on what actions can do | Custom validation logic |

> **Talk Track**: "Agentforce isn't just a convenience—it's a compliance accelerator. The Trust Layer audit logs alone can save weeks of custom development for regulated industries."

---

### 3. Building Custom? Use Named Credentials

**Never store secrets in code. Named Credentials provide secure, auditable credential management.**

If you're building a custom agentic surface (like our POC):

```
✅ Named Credentials + External Credentials
   - Secrets stored securely in Salesforce
   - Automatic token refresh
   - Per-user or per-principal authentication
   - Visible in Setup Audit Trail

❌ Hardcoded API keys in environment variables
   - No rotation without redeployment
   - No audit trail of usage
   - Credential sprawl across environments
```

> **Talk Track**: "Named Credentials aren't just for callouts *from* Salesforce—they're a pattern for managing any credential that touches your Salesforce ecosystem. Even if your app runs externally, consider whether Salesforce should be the source of truth for that credential."

---

### 4. Connected Apps with Tight OAuth Scopes

**Principle of least privilege applies to OAuth too.**

Our POC authenticated with:
```
scope: 'mcp_api refresh_token'
```

Recommendations:

| Scope | When to Include |
|-------|-----------------|
| `mcp_api` | Required for MCP Server access |
| `api` | General REST API access (broader than needed for MCP-only) |
| `einstein_gpt_api` | Required for Models API / Trust Layer |
| `refresh_token` | Enables long-lived sessions without re-auth |
| `chatter_api` | Only if agent needs Chatter access |
| `cdp_query_api` | Only if querying Data Cloud directly |

**Avoid**: `full` scope unless absolutely necessary.

> **Talk Track**: "Every scope you request is attack surface. If your agent only needs to run SOQL queries via MCP, don't request `full` access. OAuth scopes are your second permission boundary after OLS/FLS."

---

### 5. JWT Bearer Auth for Server-to-Server

**For automated/background agents, JWT eliminates credential exposure.**

Benefits:
- No client secret transmitted over the wire
- Certificate-based authentication (rotate by replacing cert)
- Works with Named Credentials and External Client Apps
- Suitable for headless/daemon processes

Implementation:
```bash
# Generate certificate
openssl req -x509 -sha256 -nodes -days 365 -newkey rsa:2048 \
  -keyout server.key -out server.crt

# Upload server.crt to Connected App in Salesforce
# Use server.key in your application for signing
```

> **Talk Track**: "If your agent runs without a human in the loop—batch jobs, scheduled briefings, automated monitoring—JWT Bearer flow is the right pattern. No passwords, no client secrets in config files."

---

### 6. Shield Event Monitoring for Visibility

**You can't secure what you can't see. EventLogFile captures all API activity.**

Our POC proved that MCP calls ARE logged in EventLogFile:

```sql
SELECT Id, EventType, LogDate, LogFileLength 
FROM EventLogFile 
WHERE EventType IN ('API', 'RestApi') 
ORDER BY LogDate DESC
```

What gets captured:
- **Endpoint**: `/services/data/v66.0/mcp/session`, `/mcp/servers/platform/sobject-all`
- **User**: Which OAuth user made the call
- **Connected App**: Which app authenticated
- **Timestamp, Duration, Status**: Full request metadata

> **Talk Track**: "We verified this in our POC—every MCP call shows up in the RestApi event log. You get timestamp, endpoint, user, and connected app for free. This is your audit trail for external agentic applications."

---

### 7. Route LLM Calls Through the Models API for Trust Layer Coverage

**Direct Anthropic/OpenAI calls bypass Salesforce's safety infrastructure.**

Our POC architecture:

```
Current:  App → Anthropic API (direct)     → ❌ No Trust Layer
Proposed: App → Salesforce Models API      → ✅ Trust Layer → LLM
```

What the Trust Layer provides:
- **Toxicity Detection**: Blocks harmful outputs
- **PII Masking**: Redacts sensitive data before it reaches the LLM
- **Prompt Defense**: Protects against injection attacks
- **Audit Logging**: Full trace in STDM (Data Cloud)

To enable:
1. Add `einstein_gpt_api` to OAuth scopes
2. Assign **Einstein Generative AI User** permission set
3. Call `/services/data/v66.0/einstein/llm/prompt/generations` instead of Anthropic directly

> **Talk Track**: "If compliance or security is a concern, the extra 100-200ms of latency through the Trust Layer is worth it. You get toxicity filtering, PII masking, and a complete audit trail in Data Cloud—capabilities that would take months to build yourself."

---

## Architecture Decision Matrix

| Requirement | Agentforce | Custom + MCP | Custom + Direct LLM |
|-------------|------------|--------------|---------------------|
| Time to market | ✅ Fastest | ⚠️ Medium | ⚠️ Medium |
| Built-in security | ✅ Yes | ⚠️ Partial | ❌ DIY |
| Trust Layer | ✅ Automatic | ✅ Via Models API | ❌ No |
| Session tracing | ✅ STDM | ⚠️ EventLogFile only | ❌ DIY logging |
| Custom UI | ❌ Limited | ✅ Full control | ✅ Full control |
| Multi-cloud LLM | ❌ SF-managed | ⚠️ Via Models API | ✅ Any provider |

---

## Summary Checklist

Before going to production with any agentic experience:

- [ ] **OLS/FLS audit** — Integration user has minimal required permissions
- [ ] **Sharing model review** — Agent sees appropriate record scope
- [ ] **OAuth scopes minimized** — No `full` unless justified
- [ ] **Named Credentials** — No secrets in code or env vars
- [ ] **JWT for server-to-server** — Certificate-based auth for background processes
- [ ] **Event Monitoring enabled** — Shield or Platform Events for API visibility
- [ ] **Trust Layer routing** — LLM calls go through Models API if compliance required
- [ ] **STDM enabled** — Session Tracing turned on for Agentforce deployments

---

## Closing Talk Track

> "Building agentic experiences is exciting, but the stakes are higher than traditional integrations. These agents make decisions, access data, and take actions on behalf of users. The recommendations we've outlined aren't about slowing you down—they're about building trust with your customers and your compliance team.
>
> If you're already on Salesforce, Agentforce gives you the fastest path to a secure, observable agentic experience. If you need a custom surface, the platform gives you the building blocks—MCP for data, Models API for LLM calls, Event Monitoring for visibility—but you need to wire them together intentionally.
>
> The POC we built proved both paths work. The question is which one fits your timeline, your compliance requirements, and your team's capabilities."

---

*Document generated from POC findings — May 2026*
