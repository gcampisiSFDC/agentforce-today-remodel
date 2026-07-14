/**
 * @description Transaction Security Policy condition that blocks API queries returning
 * more than the allowed number of Opportunity records when the request originates from
 * a personal agent / External Client App (e.g. the Salesforce DX MCP server), while
 * leaving the identical query untouched when it comes from a trusted integration such
 * as the Salesforce CLI.
 */
global with sharing class TrxSec_ThrottleAgentOppQueries implements TxnSecurity.EventCondition {
    /***********************************************************
    * BLOCK BULK OPPORTUNITY QUERIES ORIGINATING FROM A PERSONAL
    * AGENT / EXTERNAL CLIENT APP CHANNEL (E.G. AN MCP SERVER).
    ***********************************************************/

    public interface Provider {
        String resolveApplication(Id loginHistoryId, String sessionKey);
    }

    @TestVisible
    private static final Integer MAX_OPPORTUNITY_ROWS = 200;

    // Channel names (LoginHistory.Application) treated as personal agent / MCP access.
    // Extend this set if additional agent-driven ECAs are introduced.
    @TestVisible
    private static Set<String> AGENT_CHANNEL_APPLICATIONS = new Set<String>{ 'SF MCP' };

    // Best-effort cache so that a later event in the same transaction which is missing
    // LoginHistoryId (observed on some Bulk API sub-events) can still be resolved if it
    // shares a SessionKey with an earlier, resolved event.
    @TestVisible
    private static Map<String, String> sessionKeyToApplication = new Map<String, String>();

    @TestVisible
    private static Provider provider = new DefaultProvider();

    @TestVisible
    private static void resetProviderForTest() {
        provider = new DefaultProvider();
    }

    global boolean evaluate(SObject event) {
        ApiEvent apiEvent = (ApiEvent) event;

        // Handle null inputs gracefully
        if (String.isBlank(apiEvent.QueriedEntities)) {
            return false;
        }

        if (!queriesOpportunityEntity(apiEvent.QueriedEntities) || !exceedsRowThreshold(apiEvent.RowsProcessed)) {
            return false;
        }

        String application = provider.resolveApplication(apiEvent.LoginHistoryId, apiEvent.SessionKey);
        return isAgentChannel(application);
    }

    private boolean queriesOpportunityEntity(String queriedEntities) {
        for (String entity : queriedEntities.split(',')) {
            if (entity.trim().equalsIgnoreCase('Opportunity')) {
                return true;
            }
        }
        return false;
    }

    private boolean exceedsRowThreshold(Decimal rowsProcessed) {
        return rowsProcessed != null && rowsProcessed > MAX_OPPORTUNITY_ROWS;
    }

    private boolean isAgentChannel(String application) {
        return application != null && AGENT_CHANNEL_APPLICATIONS.contains(application);
    }

    private with sharing class DefaultProvider implements Provider {
        public String resolveApplication(Id loginHistoryId, String sessionKey) {
            if (loginHistoryId != null) {
                List<LoginHistory> histories = [
                    SELECT Application
                    FROM LoginHistory
                    WHERE Id = :loginHistoryId
                    LIMIT 1
                ];
                if (!histories.isEmpty()) {
                    String application = histories[0].Application;
                    if (String.isNotBlank(sessionKey)) {
                        sessionKeyToApplication.put(sessionKey, application);
                    }
                    return application;
                }
            }

            if (String.isNotBlank(sessionKey) && sessionKeyToApplication.containsKey(sessionKey)) {
                return sessionKeyToApplication.get(sessionKey);
            }

            return null;
        }
    }
}
