List<Account> accounts = new List<Account>();
for (Integer i = 0; i < 60; i++) {
    accounts.add(new Account(Name='AF Bulk Account P1 ' + String.valueOf(Datetime.now().getTime()) + '-' + i, Industry='Technology', BillingState='CA'));
}
insert accounts;

List<Lead> leads = new List<Lead>();
List<String> src = new List<String>{'Web','Phone Inquiry','Partner Referral','Purchased List','Trade Show','Other'};
List<String> st = new List<String>{'Open - Not Contacted','Working - Contacted','Nurturing','Qualified','Unqualified'};
List<String> rt = new List<String>{'Hot','Warm','Cold'};
for (Integer i = 0; i < 220; i++) {
    leads.add(new Lead(FirstName='P1', LastName='Lead' + i + '-' + String.valueOf(Datetime.now().getTime()), Company='P1 Co ' + i, Status=st[Math.mod(i, st.size())], LeadSource=src[Math.mod(i, src.size())], Industry='Technology', Rating=rt[Math.mod(i, rt.size())], Email='p1lead' + String.valueOf(Datetime.now().getTime()) + i + '@example.com'));
}
insert leads;
System.debug('COUNT Account=60');
System.debug('COUNT Lead=220');
