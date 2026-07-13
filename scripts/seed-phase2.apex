List<Lead> leads = [SELECT Id FROM Lead WHERE IsConverted = false AND LastName LIKE 'Lead%' ORDER BY CreatedDate DESC LIMIT 120];
List<Database.LeadConvert> converts = new List<Database.LeadConvert>();
for (Integer i = 0; i < leads.size(); i++) {
    Database.LeadConvert lc = new Database.LeadConvert();
    lc.setLeadId(leads[i].Id);
    lc.setConvertedStatus('Qualified');
    lc.setDoNotCreateOpportunity(Math.mod(i, 3) == 0);
    converts.add(lc);
}
Integer converted=0; Integer contacts=0; Integer opps=0;
for (Database.LeadConvertResult r : Database.convertLead(converts, false)) {
    if (r.isSuccess()) {
        converted++;
        if (r.getContactId() != null) contacts++;
        if (r.getOpportunityId() != null) opps++;
    }
}

List<Account> accts = [SELECT Id FROM Account WHERE Name LIKE 'AF Bulk Account P1%' ORDER BY CreatedDate DESC LIMIT 80];
List<Opportunity> extras = new List<Opportunity>();
List<String> stages = new List<String>{'Prospecting','Qualification','Needs Analysis','Value Proposition','Negotiation/Review','Closed Won'};
for (Integer i = 0; i < accts.size(); i++) {
    extras.add(new Opportunity(Name='AF P2 Opp ' + String.valueOf(Datetime.now().getTime()) + '-' + i, AccountId=accts[i].Id, StageName=stages[Math.mod(i, stages.size())], Amount=3000 + (i*500), CloseDate=Date.today().addDays(Math.mod(i,90)-15)));
}
insert extras;
System.debug('COUNT LeadConverted=' + converted);
System.debug('COUNT Contact(from convert)=' + contacts);
System.debug('COUNT Opportunity(from convert)=' + opps);
System.debug('COUNT Opportunity(extra)=' + extras.size());
