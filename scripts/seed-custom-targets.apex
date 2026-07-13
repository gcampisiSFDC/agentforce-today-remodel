Set<String> keywords = new Set<String>{'sentiment','engagement','pipeline','insight','todo','task','action','activity'};
Map<String, Schema.SObjectType> gd = Schema.getGlobalDescribe();
List<String> customTargets = new List<String>();
for (String apiName : gd.keySet()) {
    if (!apiName.endsWith('__c')) continue;
    String low = apiName.toLowerCase();
    for (String k : keywords) {
        if (low.contains(k)) { customTargets.add(apiName); break; }
    }
}
customTargets.sort();
System.debug('CUSTOM_TARGETS_FOUND=' + customTargets.size() + ' => ' + String.join(customTargets, ', '));

for (String apiName : customTargets) {
    Schema.DescribeSObjectResult d = gd.get(apiName).getDescribe();
    Map<String, Schema.SObjectField> fmap = d.fields.getMap();
    List<SObject> inserts = new List<SObject>();
    for (Integer i = 0; i < 20; i++) {
        SObject r = gd.get(apiName).newSObject();
        if (fmap.containsKey('Name') && fmap.get('Name').getDescribe().isCreateable() && !fmap.get('Name').getDescribe().isAutoNumber()) {
            r.put('Name', apiName.replace('__c','') + ' Seed ' + String.valueOf(Datetime.now().getTime()) + '-' + i);
        }
        inserts.add(r);
    }
    Integer ok = 0;
    for (Database.SaveResult sr : Database.insert(inserts, false)) if (sr.isSuccess()) ok++;
    System.debug('CUSTOM_OBJECT_RESULT ' + apiName + ' inserted=' + ok + ' failed=' + (20-ok));
}
