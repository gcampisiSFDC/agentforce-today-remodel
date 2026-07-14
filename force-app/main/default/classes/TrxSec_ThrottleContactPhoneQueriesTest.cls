/**
 * @description Test class for TrxSec_ThrottleContactPhoneQueries
 */
@isTest
private class TrxSec_ThrottleContactPhoneQueriesTest {
    private static ApiEvent buildEvent(String queriedEntities, String query, Decimal rowsProcessed) {
        ApiEvent testEvent = new ApiEvent();
        testEvent.QueriedEntities = queriedEntities;
        testEvent.Query = query;
        testEvent.RowsProcessed = rowsProcessed;
        return testEvent;
    }

    @isTest
    static void testAllowsWhenRowsAtThreshold() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Phone FROM Contact', 10);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when rows returned equal the threshold');
    }

    @isTest
    static void testBlocksWhenRowsExceedThreshold() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Phone FROM Contact', 11);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block when rows returned exceed the threshold');
    }

    @isTest
    static void testAllowsWhenPhoneFieldNotQueried() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Name FROM Contact', 50);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when the Phone field is not queried');
    }

    @isTest
    static void testAllowsWhenContactNotQueried() {
        ApiEvent testEvent = buildEvent('Lead', 'SELECT Id, Phone FROM Lead', 50);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should allow when Contact entity is not queried');
    }

    @isTest
    static void testDoesNotMatchFieldsContainingPhoneAsSubstring() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, MobilePhone FROM Contact', 50);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Should not treat MobilePhone as the Phone field');
    }

    @isTest
    static void testMultipleQueriedEntitiesIncludingContact() {
        ApiEvent testEvent = buildEvent('Account,Contact', 'SELECT Id, Contact.Phone FROM Account', 50);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(true, result, 'Should block when Contact is one of several queried entities');
    }

    @isTest
    static void testNullQueriedEntitiesHandled() {
        ApiEvent testEvent = buildEvent(null, 'SELECT Id, Phone FROM Contact', 50);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null QueriedEntities should be handled safely');
    }

    @isTest
    static void testNullQueryHandled() {
        ApiEvent testEvent = buildEvent('Contact', null, 50);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null Query should be handled safely');
    }

    @isTest
    static void testNullRowsProcessedHandled() {
        ApiEvent testEvent = buildEvent('Contact', 'SELECT Id, Phone FROM Contact', null);

        Boolean result = new TrxSec_ThrottleContactPhoneQueries().evaluate(testEvent);
        System.assertEquals(false, result, 'Null RowsProcessed should be handled safely');
    }
}
