/**
 * @description Test class for TrxSec_ThrottleContactEmailQueries
 */
@isTest
private class TrxSec_ThrottleContactEmailQueriesTest {
    private static ApiEvent buildEvent(String queriedEntities, String query, Decimal rowsProcessed) {
        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = queriedEntities;
        testEvent.Query = query;
        testEvent.RowsProcessed = rowsProcessed;
        return testEvent;
    }

    @isTest
    static void testAllowsWhenRowsAtThreshold() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Email FROM Contact', 10);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when rows returned equal the threshold');
    }

    @isTest
    static void testBlocksWhenRowsExceedThreshold() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Email FROM Contact', 11);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block when rows returned exceed the threshold');
    }

    @isTest
    static void testAllowsWhenEmailFieldNotQueried() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Name FROM Contact', 50);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when the Email field is not queried');
    }

    @isTest
    static void testAllowsWhenContactNotQueried() {
        ApiEvent testEvent = buildEvent('Lead', 'SELECT Id, Email FROM Lead', 50);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when Contact entity is not queried');
    }

    @isTest
    static void testDoesNotMatchFieldsContainingEmailAsSubstring() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, IsEmailBounced FROM Contact', 50);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should not treat IsEmailBounced as the Email field');
    }

    @isTest
    static void testMultipleQueriedEntitiesIncludingContact() {
        ApiEvent testEvent = buildEvent('Account,Contact', 'SELECT Id, Contact.Email FROM Account', 50);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block when Contact is one of several queried entities');
    }

    @isTest
    static void testNullQueriedEntitiesHandled() {
        ApiEvent testEvent = buildEvent(null, 'SELECT Id, Email FROM Contact', 50);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null QueriedEntities should be handled safely');
    }

    @isTest
    static void testNullQueryHandled() {
        ApiEvent testEvent = buildEvent('Contact', null, 50);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null Query should be handled safely');
    }

    @isTest
    static void testNullRowsProcessedHandled() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Email FROM Contact', null);

        Boolean result = new TrxSec_ThrottleContactEmailQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null RowsProcessed should be handled safely');
    }
}
