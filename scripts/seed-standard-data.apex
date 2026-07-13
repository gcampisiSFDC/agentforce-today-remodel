Map<String, Integer> counts = new Map<String, Integer>();

List<Account> accounts = new List<Account>();
List<String> industries = new List<String>{'Technology','Financial Services','Healthcare','Manufacturing','Retail','Education'};
for (Integer i = 0; i < 80; i++) {
    accounts.add(new Account(Name='AF Today Account ' + i, Industry=industries[Math.mod(i, industries.size())], NumberOfEmployees=50 + (i*10), Type=(Math.mod(i,3)==0 ? 'Prospect' : 'Customer'), BillingCity='City ' + Math.mod(i,20), BillingState='CA'));
}
insert accounts;
counts.put('Account', accounts.size());

List<Lead> leads = new List<Lead>();
List<String> sources = new List<String>{'Web','Phone Inquiry','Partner Referral','Purchased List','Trade Show','Other'};
List<String> statuses = new List<String>{'Open - Not Contacted','Working - Contacted','Nurturing','Qualified','Unqualified'};
List<String> ratings = new List<String>{'Hot','Warm','Cold'};
for (Integer i = 0; i < 320; i++) {
    leads.add(new Lead(FirstName='LeadFirst' + i, LastName='LeadLast' + i, Company='Prospect Co ' + i, Title='Director ' + Math.mod(i,30), Status=statuses[Math.mod(i, statuses.size())], LeadSource=sources[Math.mod(i, sources.size())], Industry=industries[Math.mod(i, industries.size())], Rating=ratings[Math.mod(i, ratings.size())], Phone='628-555-' + String.valueOf(1000 + Math.mod(i,8000)), Email='lead' + i + '@example.com', Street=String.valueOf(100+i) + ' Market St', City='San Francisco', State='CA', PostalCode='9410' + Math.mod(i,10), Country='USA'));
}
insert leads;
counts.put('Lead', leads.size());

List<Database.LeadConvert> converts = new List<Database.LeadConvert>();
for (Integer i = 0; i < 100; i++) {
    Database.LeadConvert lc = new Database.LeadConvert();
    lc.setLeadId(leads[i].Id);
    lc.setConvertedStatus('Qualified');
    lc.setDoNotCreateOpportunity(Math.mod(i, 4) == 0);
    converts.add(lc);
}
Integer converted = 0;
Set<Id> contactIds = new Set<Id>();
Set<Id> opportunityIds = new Set<Id>();
for (Database.LeadConvertResult r : Database.convertLead(converts, false)) {
    if (r.isSuccess()) {
        converted++;
        if (r.getContactId() != null) contactIds.add(r.getContactId());
        if (r.getOpportunityId() != null) opportunityIds.add(r.getOpportunityId());
    }
}
counts.put('LeadConverted', converted);

List<Contact> convertedContacts = [SELECT Id FROM Contact WHERE Id IN :contactIds];
counts.put('Contact(from convert)', convertedContacts.size());
counts.put('Opportunity(from convert)', opportunityIds.size());

List<Opportunity> extraOpps = new List<Opportunity>();
List<String> stages = new List<String>{'Prospecting','Qualification','Needs Analysis','Value Proposition','Negotiation/Review','Closed Won'};
for (Integer i = 0; i < 120; i++) {
    extraOpps.add(new Opportunity(Name='AF Today Opp ' + i, AccountId=accounts[Math.mod(i,accounts.size())].Id, StageName=stages[Math.mod(i, stages.size())], Amount=5000 + (i*650), CloseDate=Date.today().addDays(Math.mod(i,120)-30)));
}
insert extraOpps;
counts.put('Opportunity(extra)', extraOpps.size());

List<Task> tasks = new List<Task>();
List<String> priorities = new List<String>{'High','Normal','Low'};
List<String> taskStatuses = new List<String>{'Not Started','In Progress','Completed','Waiting on someone else','Deferred'};
for (Integer i = 0; i < 600; i++) {
    Task t = new Task(Subject='Follow-up #' + i, Status=taskStatuses[Math.mod(i, taskStatuses.size())], Priority=priorities[Math.mod(i, priorities.size())], ActivityDate=Date.today().addDays(Math.mod(i,45)-15), Description='Seeded engagement task #' + i);
    Integer bucket = Math.mod(i,4);
    if (bucket == 0) t.WhoId = leads[100 + Math.mod(i, leads.size()-100)].Id;
    else if (bucket == 1 && !convertedContacts.isEmpty()) t.WhoId = convertedContacts[Math.mod(i, convertedContacts.size())].Id;
    else if (bucket == 2) t.WhatId = accounts[Math.mod(i, accounts.size())].Id;
    else if (!extraOpps.isEmpty()) t.WhatId = extraOpps[Math.mod(i, extraOpps.size())].Id;
    tasks.add(t);
}
insert tasks;
counts.put('Task', tasks.size());

List<Event> events = new List<Event>();
for (Integer i = 0; i < 280; i++) {
    Datetime startAt = System.now().addDays(Math.mod(i,40)-10).addHours(Math.mod(i,8));
    Event e = new Event(Subject='Customer touchpoint #' + i, StartDateTime=startAt, EndDateTime=startAt.addHours(1), Description='Seeded meeting/call #' + i);
    Integer bucket = Math.mod(i,3);
    if (bucket == 0) e.WhoId = leads[100 + Math.mod(i, leads.size()-100)].Id;
    else if (bucket == 1 && !convertedContacts.isEmpty()) e.WhoId = convertedContacts[Math.mod(i, convertedContacts.size())].Id;
    else if (!extraOpps.isEmpty()) e.WhatId = extraOpps[Math.mod(i, extraOpps.size())].Id;
    events.add(e);
}
insert events;
counts.put('Event', events.size());

List<ContentNote> noteRecords = new List<ContentNote>();
for (Integer i = 0; i < 150; i++) {
    ContentNote cn = new ContentNote();
    cn.Title = 'Engagement Note ' + i;
    cn.Content = Blob.valueOf('Seeded note body ' + i + ' with context and sentiment cues.');
    noteRecords.add(cn);
}
insert noteRecords;
counts.put('ContentNote', noteRecords.size());

List<ContentDocumentLink> links = new List<ContentDocumentLink>();
for (Integer i = 0; i < noteRecords.size(); i++) {
    Id linkedId;
    Integer bucket = Math.mod(i,4);
    if (bucket == 0) linkedId = leads[100 + Math.mod(i, leads.size()-100)].Id;
    else if (bucket == 1 && !convertedContacts.isEmpty()) linkedId = convertedContacts[Math.mod(i, convertedContacts.size())].Id;
    else if (bucket == 2) linkedId = accounts[Math.mod(i, accounts.size())].Id;
    else linkedId = extraOpps[Math.mod(i, extraOpps.size())].Id;
    links.add(new ContentDocumentLink(ContentDocumentId=noteRecords[i].Id, LinkedEntityId=linkedId, ShareType='V', Visibility='AllUsers'));
}
Integer linkSuccess = 0;
for (Database.SaveResult sr : Database.insert(links, false)) if (sr.isSuccess()) linkSuccess++;
counts.put('ContentDocumentLink', linkSuccess);

System.debug('SEED_COUNTS_START');
List<String> keys = new List<String>(counts.keySet()); keys.sort();
for (String k : keys) System.debug('COUNT ' + k + '=' + counts.get(k));
System.debug('SEED_COUNTS_END');
