/**
 * @description Test class for TrxSec_DetectHighRiskAPIQueries
 */
@isTest
private class TrxSec_DetectHighRiskAPIQueriesTest {
    private class StubProvider implements TrxSec_DetectHighRiskAPIQueries.Provider {
        private final List<String> highRiskLevels;
        private final List<String> confidentialFields;

        StubProvider(List<String> highRiskLevels, List<String> confidentialFields) {
            this.highRiskLevels = highRiskLevels;
            this.confidentialFields = confidentialFields;
        }

        public List<String> getHighRiskLevels() {
            return highRiskLevels == null ? new List<String>() : highRiskLevels;
        }

        public List<String> getConfidentialFields(String entity, List<String> ignoredHighRiskLevels) {
            return confidentialFields == null ? new List<String>() : confidentialFields;
        }
    }

    private static void useProvider(List<String> highRiskLevels, List<String> confidentialFields) {
        TrxSec_DetectHighRiskAPIQueries.provider = new StubProvider(highRiskLevels, confidentialFields);
    }

    @isTest
    static void testReturnsFalseWhenNoHighRiskLevelsConfigured() {
        useProvider(new List<String>(), new List<String>());

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Account';
        testEvent.Query = 'SELECT Id, Name FROM Account';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when no high-risk levels are configured');
    }

    @isTest
    static void testNullQueriedEntitiesHandled() {
        useProvider(new List<String>{'HIGH'}, new List<String>{'ssn__c'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = null;
        testEvent.Query = 'SELECT Id, Name FROM Account';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null QueriedEntities should be handled safely');
    }

    @isTest
    static void testNullQueryHandled() {
        useProvider(new List<String>{'HIGH'}, new List<String>{'ssn__c'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Account';
        testEvent.Query = null;

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null Query should be handled safely');
    }

    @isTest
    static void testDetectsConfidentialFieldInQuery() {
        useProvider(new List<String>{'HIGH'}, new List<String>{'ssn__c'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Account';
        testEvent.Query = 'SELECT Id, SSN__c FROM Account';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should detect confidential field in query');
    }

    @isTest
    static void testBlocksPaymentMethodCreditCardNumberQuery() {
        useProvider(new List<String>{'Restricted'}, new List<String>{'credit_card_number'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Payment_Method__c';
        testEvent.Query = 'SELECT Id, Credit_Card_Number__c FROM Payment_Method__c';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block queries requesting the credit card number');
    }

    @isTest
    static void testAllowsPaymentMethodNonSensitiveFieldsQuery() {
        useProvider(new List<String>{'Restricted'}, new List<String>{'credit_card_number'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Payment_Method__c';
        testEvent.Query = 'SELECT Id, Name, Card_Brand__c, Payment_Type__c FROM Payment_Method__c';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow queries requesting only non-sensitive fields');
    }

    @isTest
    static void testDoesNotDetectWhenFieldNotPresent() {
        useProvider(new List<String>{'HIGH'}, new List<String>{'ssn__c'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Account';
        testEvent.Query = 'SELECT Id, Name FROM Account';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should not detect when field is not present');
    }

    @isTest
    static void testMultipleEntitiesEvaluated() {
        useProvider(new List<String>{'HIGH'}, new List<String>{'ssn__c'});

        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = 'Account,Contact';
        testEvent.Query = 'SELECT Id, SSN__c FROM Account';

        Boolean result = new TrxSec_DetectHighRiskAPIQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should evaluate multiple entities and detect confidential fields');
    }

    @isTest
    static void testDefaultProviderMethodsCovered() {
        // Reset to the real provider so DefaultProvider methods are executed and covered
        TrxSec_DetectHighRiskAPIQueries.resetProviderForTest();

        List<String> levels = TrxSec_DetectHighRiskAPIQueries.provider.getHighRiskLevels();
        System.assertNotEquals(null, levels, 'High risk levels list should not be null');

        // Use a real EntityDefinition durable id to avoid assumptions about QueriedEntities format
        String accountEntityDefinitionId = [
            SELECT DurableId
            FROM EntityDefinition
            WHERE QualifiedApiName = 'Account'
            LIMIT 1
        ].DurableId;

        // Pass a non-empty classification list so the SOQL in getConfidentialFields executes
        List<String> fields = TrxSec_DetectHighRiskAPIQueries.provider.getConfidentialFields(
            accountEntityDefinitionId,
            new List<String>{'HIGH'}
        );
        System.assertNotEquals(null, fields, 'Confidential fields list should not be null');
    }
}
