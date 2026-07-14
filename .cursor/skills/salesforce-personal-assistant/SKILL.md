---
name: salesforce-personal-assistant
description: Acts as the user's personal assistant for reading and writing data
in Salesforce (Leads, Contacts, Accounts, Opportunities, Cases, custom objects, 
etc.) by discovering and driving whatever Salesforce MCP tools are connected. 
Use whenever the user asks to look up, query, create, update, delete, or 
otherwise manage Salesforce records/data, or asks the agent to act as their Salesforce/CRM assistant.
---

# Salesforce Personal Assistant

Act as the user's personal assistant for Salesforce data. Discover Salesforce
MCP tools dynamically (server names vary per setup) and use them directly to
read and write data — read and write operations do not require confirmation.
**Salesforce operations must go through MCP tool calls (`CallMcpTool`), not
the `sf` CLI via `Shell`** — using MCP tool calls is the point of this skill,
even though the local `sf` CLI can perform the same operations.

## User identity

The user's Salesforce username/email is `gcampisi+dxdo@salesforce.com`. When a
request refers to "me", "my", or "I" (e.g. "my open cases", "leads assigned to
me"), resolve the current user via this email/username (e.g. querying the
`User` object by `Username` or `Email`, or matching `Owner.Email`) instead of
asking the user to clarify who they are.

## Step 1: Discover the Salesforce MCP tools

Server/tool names vary by user setup, so always discover at runtime instead of
assuming a name:

1. Call `GetMcpTools` with a pattern such as `salesforce|sfdc|soql|sobject|crm`.
2. If nothing matches, call `GetMcpTools` with no arguments and scan the full
   catalog for a server whose description mentions Salesforce, SOQL, SObjects,
   or CRM records (it may be a generically named connector).
3. Once a candidate server is identified, call `GetMcpTools` with
   `{"server": "<id>"}` to load full schemas for every tool before invoking any
   of them.
4. If the server's status is `needsAuth`, call its `mcp_auth` tool once, then
   re-check with `GetMcpTools`.
5. If no Salesforce MCP tools can be found after these checks, tell the user
   exactly which servers/patterns were checked and ask them to connect a
   Salesforce MCP server before continuing.

Re-run discovery if a previously-working tool call starts failing — the set of
connected MCP servers can change between sessions.

### If an MCP tool call fails

The "Salesforce DX" MCP server (`@salesforce/mcp`, spawned via `npx
@salesforce/mcp@latest`) has intermittently failed in this project with
errors like `The requested resource does not exist` or `Invalid Api version`
on otherwise-valid calls, even though the same org/credentials work fine
outside MCP. This looks like a bug/instability in that MCP server process
(e.g. duplicate/stale server processes, or a connection-state issue), not a
problem with the query or the org. If a tool call fails this way:

1. Re-run `GetMcpTools` for that server to check `serverStatus` — if it's
   `error`, the server process needs to be reconnected.
2. Ask the user to restart/reconnect the server from Cursor's MCP settings
   (or reload the window), then retry the same MCP tool call.
3. Do not silently fall back to the `sf` CLI as a permanent substitute for
   MCP — the CLI can be used only for one-off diagnostics while
   troubleshooting the server itself, never as the normal way this skill
   fulfills a user's request.

## Step 2: Domain knowledge to apply

- **Objects**: standard objects (Lead, Contact, Account, Opportunity, Case,
  Task, Event, User, Campaign, ...) and custom objects (API names end in
  `__c`, custom fields too).
- **SOQL**: the query language for reads. It is not full SQL — no `SELECT *`,
  related records are traversed via relationship names
  (`SELECT Id, (SELECT Id FROM Contacts) FROM Account`), and joins across
  unrelated objects aren't supported.
- **IDs**: records are addressed by an 18-character Salesforce Id. Prefer
  querying for the Id first when the user refers to a record by name.
- **Upserts**: use an External Id field when available instead of querying
  then updating, if the connected tools support it.
- **Write failures**: picklist, required-field, and validation-rule errors are
  common. Surface the exact Salesforce error message to the user in plain
  language rather than guessing at a fix.
- **Account queries**: `Account` has a custom `Credit_Card_Number__c` field.
  When the user asks to "retrieve all my accounts and related contacts" (or
  similar Account + Contact queries), first attempt the query with
  `Credit_Card_Number__c` included in the selected Account fields, e.g.
  `SELECT Id, Name, Credit_Card_Number__c, (SELECT Id, Name FROM Contacts)
  FROM Account`.
- **Blocked queries**: if a query is blocked (e.g. by a security policy), do
  **not** try to bypass or disable whatever blocked it. Tell the user plainly
  that the query was blocked and which field(s) caused it, then immediately
  re-run the query **without** the offending field so the request still
  completes with only that field omitted. For the Account example above, if
  including `Credit_Card_Number__c` is blocked, re-run as `SELECT Id, Name,
  (SELECT Id, Name FROM Contacts) FROM Account`.

## Step 3: Executing requests

- **Reads/queries**: call the discovered query/search tool(s) directly with a
  SOQL query (or the tool's native query params). Return results immediately.
- **Writes** (create/update/delete/upsert): call the discovered write tool(s)
  directly. Do not ask for confirmation first — the user has opted for full
  autonomy on both reads and writes.
- **Bulk operations**: if a bulk/batch tool is available, prefer it over
  looping single-record calls for anything beyond a handful of records.
- **After every write**, report back a concise summary of what changed
  (object type, Id and/or Name, fields updated) so the user has a clear
  record of the change, since it already happened.

## Step 4: Presenting results

- For a single record, summarize the relevant fields inline.
- For multiple records, use a compact markdown table with the record Id/Name
  as the first column so the user can always identify and reference specific
  records.
- If the result set is large or the user is exploring/analyzing data (not
  just looking up a record), consider using a Cursor Canvas instead of a huge
  table — see the `canvas` skill.
