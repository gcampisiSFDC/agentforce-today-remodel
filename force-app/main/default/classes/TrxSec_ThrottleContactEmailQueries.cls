/**
 * @description Transaction Security Policy condition that throttles API queries
 * returning more than the allowed number of Contact records when the Email field
 * is queried.
 */
global with sharing class TrxSec_ThrottleContactEmailQueries implements TxnSecurity.EventCondition {
    /***********************************************************
    * BLOCK API QUERIES THAT RETURN MORE THAN THE ALLOWED NUMBER
    * OF CONTACT ROWS WHEN THE EMAIL FIELD IS QUERIED.
    ***********************************************************/

    @TestVisible
    private static final Integer MAX_CONTACT_EMAIL_ROWS = 10;

    private static final Pattern EMAIL_FIELD_PATTERN = Pattern.compile('(?i)\\bemail\\b');

    global boolean evaluate(SObject event) {
        ApiEvent apiEvent = (ApiEvent) event;

        // Handle null inputs gracefully
        if (String.isBlank(apiEvent.QueriedEntities) || String.isBlank(apiEvent.Query)) {
            return false;
        }

        if (!queriesContactEntity(apiEvent.QueriedEntities) || !queriesEmailField(apiEvent.Query)) {
            return false;
        }

        return exceedsRowThreshold(apiEvent.RowsProcessed);
    }

    private boolean queriesContactEntity(String queriedEntities) {
        for (String entity : queriedEntities.split(',')) {
            if (entity.trim().equalsIgnoreCase('Contact')) {
                return true;
            }
        }
        return false;
    }

    private boolean queriesEmailField(String query) {
        return EMAIL_FIELD_PATTERN.matcher(query).find();
    }

    private boolean exceedsRowThreshold(Decimal rowsProcessed) {
        return rowsProcessed != null && rowsProcessed > MAX_CONTACT_EMAIL_ROWS;
    }
}
