String runTag = 'AFD-20260708204300';
Integer accountCount=220, contactsPerAccount=2, oppsPerAccount=3;
List<User> users = [SELECT Id FROM User WHERE IsActive = true AND UserType = 'Standard' LIMIT 12];
if (users.isEmpty()) users = [SELECT Id FROM User WHERE IsActive = true LIMIT 1];
List<String> stages = new List<String>();
for (Schema.PicklistEntry pe : Opportunity.StageName.getDescribe().getPicklistValues()) if (pe.isActive()) stages.add(pe.getValue());
if (stages.isEmpty()) stages.add('Prospecting');

List<Account> accts = new List<Account>();
for (Integer i=0;i<accountCount;i++) accts.add(new Account(Name=runTag+'-Account-'+String.valueOf(i).leftPad(4,'0'),Industry=new List<String>{'Technology','Healthcare','Retail','Finance'}[Math.mod(i,4)],Phone='415-555-'+String.valueOf(1000+Math.mod(i,9000)),BillingCity=new List<String>{'SF','NYC','Austin','Seattle'}[Math.mod(i,4)],BillingCountry='United States',OwnerId=users[Math.mod(i,users.size())].Id,Description='Seeded demo account '+runTag));
insert accts;

List<Contact> cons = new List<Contact>();
for (Integer i=0;i<accts.size();i++) for (Integer c=0;c<contactsPerAccount;c++) { Integer n=i*contactsPerAccount+c; cons.add(new Contact(FirstName='Demo'+n,LastName=runTag+'-Contact-'+n,Email=('demo+'+runTag.toLowerCase().replace('-','')+n+'@example.com').left(80),Title=new List<String>{'VP Sales','CFO','COO','Director'}[Math.mod(n,4)],AccountId=accts[i].Id,OwnerId=users[Math.mod(n,users.size())].Id)); }
insert cons;
Map<Id,List<Contact>> consByAcct = new Map<Id,List<Contact>>();
for (Contact c : cons){ if(!consByAcct.containsKey(c.AccountId)) consByAcct.put(c.AccountId,new List<Contact>()); consByAcct.get(c.AccountId).add(c);} 

List<Opportunity> opps = new List<Opportunity>();
for (Integer i=0;i<accts.size();i++) for (Integer o=0;o<oppsPerAccount;o++) { Integer n=i*oppsPerAccount+o; opps.add(new Opportunity(Name=runTag+'-Opp-'+String.valueOf(n).leftPad(5,'0'),AccountId=accts[i].Id,StageName=stages[Math.mod(n,stages.size())],Amount=15000+Math.mod(n*9173,220000),CloseDate=Date.today().addDays(-30+Math.mod(n,220)),Type=new List<String>{'New Customer','Existing Customer - Upgrade','Existing Customer - Replacement'}[Math.mod(n,3)],LeadSource=new List<String>{'Web','Partner Referral','Phone Inquiry','Trade Show'}[Math.mod(n,4)],OwnerId=users[Math.mod(n,users.size())].Id,NextStep='Advance stage',Description='Seeded opp '+runTag)); }
insert opps;

List<OpportunityContactRole> ocrs = new List<OpportunityContactRole>();
for (Integer i=0;i<opps.size();i++) { List<Contact> ac = consByAcct.get(opps[i].AccountId); if (ac==null || ac.isEmpty()) continue; ocrs.add(new OpportunityContactRole(OpportunityId=opps[i].Id,ContactId=ac[Math.mod(i,ac.size())].Id,Role='Decision Maker',IsPrimary=true)); }
insert ocrs;

List<Task> tasks = new List<Task>(); List<Event> events = new List<Event>();
for (Integer i=0;i<opps.size();i++) { List<Contact> ac = consByAcct.get(opps[i].AccountId); Contact who = ac[Math.mod(i,ac.size())]; for (Integer t=0;t<2;t++) { Integer n=i*2+t; tasks.add(new Task(Subject=runTag+' Follow-up '+n,Status=new List<String>{'Not Started','In Progress','Completed'}[Math.mod(n,3)],Priority=new List<String>{'High','Normal','Low'}[Math.mod(n,3)],ActivityDate=Date.today().addDays(-Math.mod(n,120)),WhatId=(Math.mod(n,4)==0?opps[i].AccountId:opps[i].Id),WhoId=who.Id,OwnerId=users[Math.mod(n,users.size())].Id,Description='Seed activity')); } Datetime st = Datetime.now().addDays(Math.mod(i,90)-30).addHours(Math.mod(i,8)); events.add(new Event(Subject=runTag+' Meeting '+i,StartDateTime=st,EndDateTime=st.addMinutes(30+Math.mod(i,60)),WhatId=(Math.mod(i,5)==0?opps[i].AccountId:opps[i].Id),WhoId=who.Id,OwnerId=users[Math.mod(i,users.size())].Id)); }
insert tasks; insert events;

try { Pricebook2 pb=[SELECT Id,IsActive FROM Pricebook2 WHERE IsStandard=true LIMIT 1]; if(!pb.IsActive){pb.IsActive=true; update pb;} List<Product2> p2=new List<Product2>(); for(Integer i=0;i<12;i++) p2.add(new Product2(Name=runTag+'-Product-'+i,Family='Software',IsActive=true)); insert p2; List<PricebookEntry> pbe=new List<PricebookEntry>(); for(Integer i=0;i<p2.size();i++) pbe.add(new PricebookEntry(Pricebook2Id=pb.Id,Product2Id=p2[i].Id,UnitPrice=499+(i*125),IsActive=true,UseStandardPrice=false)); insert pbe; List<OpportunityLineItem> oli=new List<OpportunityLineItem>(); Integer target=Math.min(opps.size(),360); for(Integer i=0;i<target;i++) oli.add(new OpportunityLineItem(OpportunityId=opps[i].Id,PricebookEntryId=pbe[Math.mod(i,pbe.size())].Id,Quantity=1+Math.mod(i,6),UnitPrice=pbe[Math.mod(i,pbe.size())].UnitPrice)); insert oli; } catch (Exception ex) { System.debug('LINE_ITEMS_SKIPPED:'+ex.getMessage()); }

System.debug('SEED_TAG='+runTag);
System.debug('SEED_BASE_COUNTS: A='+accts.size()+' C='+cons.size()+' O='+opps.size()+' OCR='+ocrs.size()+' T='+tasks.size()+' E='+events.size()+' OWNERS='+users.size());
