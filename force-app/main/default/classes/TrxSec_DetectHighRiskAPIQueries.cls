/**
 * @description Transaction Security Policy condition to detect API queries based on high-risk fields
 */
global with sharing class TrxSec_DetectHighRiskAPIQueries implements TxnSecurity.EventCondition {
    /***********************************************************
    * DETECT API QUERIES WITH A FIELD CLASSIFIED AS HIGH-RISK.
    ***********************************************************/

    public interface Provider {
        List<String> getHighRiskLevels();
        List<String> getConfidentialFields(String entity, List<String> highRiskLevels);
    }

    @TestVisible
    private static Provider provider = new DefaultProvider();

    @TestVisible
    private static void resetProviderForTest() {
        provider = new DefaultProvider();
    }

    global boolean evaluate(SObject event){
        List<String> highRiskLevels = provider.getHighRiskLevels();
        if (highRiskLevels.isEmpty()) { return false; }

        ApiEvent ApiEvent = (ApiEvent) event;
        
        // Handle null inputs gracefully
        if (String.isBlank(ApiEvent.QueriedEntities) || String.isBlank(ApiEvent.Query)) {
            return false;
        }
        
        return hasConfidentialFields(ApiEvent.QueriedEntities.toLowerCase(), ApiEvent.Query, highRiskLevels);
    }
    
    private boolean hasConfidentialFields(String entities, String query, List<String> highRiskLevels){
        List<String> entityList = entities.split(',');
        // system.debug(entityList);
        for(String entity : entityList) {
            List<String> confidentialFields = provider.getConfidentialFields(entity, highRiskLevels);
            for(String confidentialField : confidentialFields) {
                if (query.containsIgnoreCase(confidentialField)) {
                    return true;
                }
            }
        }   
        
        return false;
    }

    private with sharing class DefaultProvider implements Provider {
        public List<String> getHighRiskLevels() {
            List<FieldSecurityClassification> fieldSecurityClassifications = [
                SELECT ApiName
                FROM FieldSecurityClassification
                WHERE IsHighRiskLevel = TRUE
            ];

            List<String> levels = new List<String>();
            for (FieldSecurityClassification fieldSecurityClassification : fieldSecurityClassifications) {
                levels.add(fieldSecurityClassification.ApiName);
            }
            return levels;
        }

        public List<String> getConfidentialFields(String entity, List<String> highRiskLevels) {
            if (highRiskLevels == null || highRiskLevels.isEmpty()) {
                return new List<String>();
            }

            List<FieldDefinition> fieldDefinitions = [
                SELECT DeveloperName
                FROM FieldDefinition
                WHERE EntityDefinitionId = :entity
                AND SecurityClassification in :highRiskLevels
            ];

            List<String> confidentialFields = new List<String>();
            for (FieldDefinition fieldDefinition : fieldDefinitions) {
                confidentialFields.add(fieldDefinition.DeveloperName.toLowerCase());
            }
            return confidentialFields;
        }
    }
}
