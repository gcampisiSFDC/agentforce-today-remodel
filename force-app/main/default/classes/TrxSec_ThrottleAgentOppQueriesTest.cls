/**
 * @description Test class for TrxSec_ThrottleAgentOppQueries
 */
@isTest
private class TrxSec_ThrottleAgentOppQueriesTest {
    private class StubProvider implements TrxSec_ThrottleAgentOppQueries.Provider {
        private final String application;

        StubProvider(String application) {
            this.application = application;
        }

        public String resolveApplication(Id loginHistoryId, String sessionKey) {
            return application;
        }
    }

    private static void useProvider(String application) {
        TrxSec_ThrottleAgentOppQueries.provider = new StubProvider(application);
    }

    private static ApiEvent buildEvent(String queriedEntities, Decimal rowsProcessed) {
        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = queriedEntities;
        testEvent.RowsProcessed = rowsProcessed;
        return testEvent;
    }

    @isTest
    static void testAllowsWhenRowsAtThreshold() {
        useProvider('SF MCP');
        ApiEvent testEvent = buildEvent('Opportunity', 200);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when rows returned equal the threshold');
    }

    @isTest
    static void testBlocksWhenRowsExceedThresholdAndAgentChannel() {
        useProvider('SF MCP');
        ApiEvent testEvent = buildEvent('Opportunity', 201);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block when rows exceed threshold and the channel is a personal agent/MCP');
    }

    @isTest
    static void testAllowsWhenRowsExceedThresholdButTrustedChannel() {
        useProvider('Salesforce CLI');
        ApiEvent testEvent = buildEvent('Opportunity', 500);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when rows exceed threshold but the channel is a trusted integration like the Salesforce CLI');
    }

    @isTest
    static void testAllowsWhenChannelUnresolved() {
        useProvider(null);
        ApiEvent testEvent = buildEvent('Opportunity', 500);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should fail open (allow) when the channel cannot be resolved');
    }

    @isTest
    static void testAllowsWhenOpportunityNotQueried() {
        useProvider('SF MCP');
        ApiEvent testEvent = buildEvent('Account', 500);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when Opportunity entity is not queried');
    }

    @isTest
    static void testMultipleEntitiesIncludingOpportunity() {
        useProvider('SF MCP');
        ApiEvent testEvent = buildEvent('Account,Opportunity', 300);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block when Opportunity is one of several queried entities');
    }

    @isTest
    static void testNullQueriedEntitiesHandled() {
        useProvider('SF MCP');
        ApiEvent testEvent = buildEvent(null, 500);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null QueriedEntities should be handled safely');
    }

    @isTest
    static void testNullRowsProcessedHandled() {
        useProvider('SF MCP');
        ApiEvent testEvent = buildEvent('Opportunity', null);

        Boolean result = new TrxSec_ThrottleAgentOppQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null RowsProcessed should be handled safely');
    }

    @isTest
    static void testDefaultProviderResolvesRealLoginHistoryAndCachesSessionKey() {
        // Reset to the real provider so DefaultProvider methods are executed and covered
        TrxSec_ThrottleAgentOppQueries.resetProviderForTest();

        LoginHistory recentLogin = [SELECT Id, Application FROM LoginHistory ORDER BY LoginTime DESC LIMIT 1];
        String sessionKey = 'test-session-key-' + recentLogin.Id;

        String resolved = TrxSec_ThrottleAgentOppQueries.provider.resolveApplication(recentLogin.Id, sessionKey);
        System.assertEquals(recentLogin.Application, resolved, 'Should resolve the Application from the real LoginHistory record');

        // A subsequent event with the same SessionKey but no LoginHistoryId should fall back to the cached value.
        String cached = TrxSec_ThrottleAgentOppQueries.provider.resolveApplication(null, sessionKey);
        System.assertEquals(recentLogin.Application, cached, 'Should fall back to the cached Application for a matching SessionKey');
    }

    @isTest
    static void testDefaultProviderReturnsNullWhenUnresolvable() {
        TrxSec_ThrottleAgentOppQueries.resetProviderForTest();

        String resolved = TrxSec_ThrottleAgentOppQueries.provider.resolveApplication(null, 'unseen-session-key');
        System.assertEquals(null, resolved, 'Should return null when neither LoginHistoryId nor a cached SessionKey resolve');
    }
}
