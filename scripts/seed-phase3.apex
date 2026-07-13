List<Lead> leads = [SELECT Id FROM Lead WHERE IsConverted = false AND LastName LIKE 'Lead%' ORDER BY CreatedDate DESC LIMIT 180];
List<Contact> contacts = [SELECT Id FROM Contact WHERE LastName LIKE 'Lead%' ORDER BY CreatedDate DESC LIMIT 140];
List<Account> accounts = [SELECT Id FROM Account WHERE Name LIKE 'AF Bulk Account P1%' ORDER BY CreatedDate DESC LIMIT 80];
List<Opportunity> opps = [SELECT Id FROM Opportunity WHERE Name LIKE 'AF P2 Opp%' ORDER BY CreatedDate DESC LIMIT 60];

List<Task> tasks = new List<Task>();
List<String> priorities = new List<String>{'High','Normal','Low'};
List<String> taskStatuses = new List<String>{'Not Started','In Progress','Completed','Waiting on someone else','Deferred'};
for (Integer i = 0; i < 320; i++) {
    Task t = new Task(Subject='AF Todo #' + String.valueOf(Datetime.now().getTime()) + '-' + i, Status=taskStatuses[Math.mod(i, taskStatuses.size())], Priority=priorities[Math.mod(i, priorities.size())], ActivityDate=Date.today().addDays(Math.mod(i,35)-10), Description='Seeded to-do activity #' + i);
    Integer bucket = Math.mod(i,4);
    if (bucket == 0 && !leads.isEmpty()) t.WhoId = leads[Math.mod(i, leads.size())].Id;
    else if (bucket == 1 && !contacts.isEmpty()) t.WhoId = contacts[Math.mod(i, contacts.size())].Id;
    else if (bucket == 2 && !accounts.isEmpty()) t.WhatId = accounts[Math.mod(i, accounts.size())].Id;
    else if (!opps.isEmpty()) t.WhatId = opps[Math.mod(i, opps.size())].Id;
    tasks.add(t);
}
insert tasks;

List<Event> events = new List<Event>();
for (Integer i = 0; i < 180; i++) {
    Datetime startAt = System.now().addDays(Math.mod(i,30)-8).addHours(Math.mod(i,8));
    Event e = new Event(Subject='AF Engagement #' + String.valueOf(Datetime.now().getTime()) + '-' + i, StartDateTime=startAt, EndDateTime=startAt.addHours(1), Description='Seeded meeting/call #' + i);
    Integer bucket = Math.mod(i,3);
    if (bucket == 0 && !leads.isEmpty()) e.WhoId = leads[Math.mod(i, leads.size())].Id;
    else if (bucket == 1 && !contacts.isEmpty()) e.WhoId = contacts[Math.mod(i, contacts.size())].Id;
    else if (!opps.isEmpty()) e.WhatId = opps[Math.mod(i, opps.size())].Id;
    events.add(e);
}
insert events;

List<ContentNote> noteRecords = new List<ContentNote>();
for (Integer i = 0; i < 120; i++) {
    ContentNote cn = new ContentNote();
    cn.Title = 'AF Note ' + String.valueOf(Datetime.now().getTime()) + '-' + i;
    cn.Content = Blob.valueOf('Seeded note body #' + i + ' with sentiment and action context.');
    noteRecords.add(cn);
}
insert noteRecords;

List<ContentDocumentLink> links = new List<ContentDocumentLink>();
for (Integer i = 0; i < noteRecords.size(); i++) {
    Id linkedId;
    Integer bucket = Math.mod(i,4);
    if (bucket == 0 && !leads.isEmpty()) linkedId = leads[Math.mod(i, leads.size())].Id;
    else if (bucket == 1 && !contacts.isEmpty()) linkedId = contacts[Math.mod(i, contacts.size())].Id;
    else if (bucket == 2 && !accounts.isEmpty()) linkedId = accounts[Math.mod(i, accounts.size())].Id;
    else if (!opps.isEmpty()) linkedId = opps[Math.mod(i, opps.size())].Id;
    if (linkedId != null) links.add(new ContentDocumentLink(ContentDocumentId=noteRecords[i].Id, LinkedEntityId=linkedId, ShareType='V', Visibility='AllUsers'));
}
Integer linkSuccess = 0;
for (Database.SaveResult sr : Database.insert(links, false)) if (sr.isSuccess()) linkSuccess++;

System.debug('COUNT Task=' + tasks.size());
System.debug('COUNT Event=' + events.size());
System.debug('COUNT ContentNote=' + noteRecords.size());
System.debug('COUNT ContentDocumentLink=' + linkSuccess);
