// Sample mail for demo mode (open the site with ?demo). Nothing is fetched from Gmail and nothing is saved
// to your account. The scenarios follow the folder rules (Reminder Summary, Customer Invoicing, …).
const H = 3600_000;
export function demoMessages(now = Date.now()) {
  const m = (id, thread, ago, fromName, fromEmail, subject, body, extra = {}) => ({
    id, threadId: thread, historyId: 1, fromName, fromEmail, toLine: extra.to || 'billing@teamleadgeneration.com', ccLine: extra.cc || '',
    subject, snippet: body.slice(0, 120), body, receivedAt: now - ago, labelIds: (extra.labels || ['INBOX']).join(','),
    attachments: (extra.atts || []).map((a) => `${a}|application/pdf|20480`).join('\n'), hasUnsubscribe: !!extra.unsub, isFromMe: !!extra.me,
  });
  return [
    // Reminder Summary
    m('d1', 't1', 0.2 * H, 'Bill.com', 'no-reply@hq.bill.com', 'Your Bill.com verification code', 'Your verification code is 482913. It expires in 10 minutes.', { to: 'tlgbilling29@gmail.com' }),
    m('d2a', 't2', 30 * H, 'Olivia', 'tlgbilling29@gmail.com', 'Payment reminder - Invoice 4512', 'Hi, this is a friendly payment reminder that invoice 4512 for $820.00 is past due.', { to: 'ap@abcdental-demo.com', cc: 'billing@teamleadgeneration.com' }),
    m('d2b', 't2', 20 * H, 'ABC Dental', 'ap@abcdental-demo.com', 'Re: Payment reminder - Invoice 4512', 'Sorry, our payment will be late. We will pay next week.', { to: 'tlgbilling29@gmail.com' }),
    m('d2c', 't2', 2 * H, 'Mike', 'mike@demo-client.com', 'Re: Payment reminder - Invoice 4512', 'We need this cleared this week please. Olivia, keep me posted.', { to: 'ap@abcdental-demo.com', cc: 'tlgbilling29@gmail.com' }),
    m('d3', 't3', 26 * H, 'Bright Smiles', 'ap@brightsmiles-demo.com', 'Re: Payment reminder - Invoice 2210', 'We already paid this invoice on Oct 10. Remittance attached.'),
    // Customer Invoicing
    m('d4', 't4', 4 * H, 'Syed Ali', 'syed@demo-sales.com', 'Rate change - ABC Dental', 'Rate change for ABC Dental: the new rate is $50 per appointment from Nov 1.'),
    m('d5', 't5', 9 * H, 'SaasAnt', 'support@saasant.com', 'Import failed', 'Your import failed: 3 invoices could not be synced to QuickBooks Online.'),
    m('d6', 't6', 28 * H, 'Smile Clinic', 'office@smileclinic-demo.com', 'Invoice 7781', 'Invoice 7781 has a duplicate amount - we were charged twice for the same appointments.'),
    // Call Center Bonus
    m('d7', 't7', 6 * H, 'Janilin Cruz', 'janilin@demo-callcenter.com', 'Completed appointments - week 43', 'Hi, attached is the list of completed appointments for this week.', { atts: ['completed_appointments_w43.pdf'] }),
    m('d8', 't8', 40 * H, 'Agent Leo', 'leo@demo-callcenter.com', 'Bonus date', 'When will the call center bonus be paid this week?'),
    // Mike and April Mail
    m('d9', 't9', 1 * H, 'Mike', 'mike@demo-client.com', 'Quick note', 'Dev, please have a look at the ABC Dental account today.'),
    m('d10', 't10', 12 * H, 'April', 'april@demo-client.com', 'Tracker', 'Could you update the shared tracker when you get a chance?', { to: 'tlgmailcheck75@gmail.com' }),
    // Payroll Process
    m('d11', 't11', 3 * H, 'Jose Santos', 'jose@demo-staff.com', 'Salary', 'My salary has not been received yet. It is delayed by a week.'),
    m('d12', 't12', 22 * H, 'Edna Gail', 'edna.gail@demo-staff.com', 'Weekly hours', 'Hi, my work hours this week: 40 hours. Pay period Oct 13 - Oct 19.'),
    // Other Mails
    m('d13', 't13', 8 * H, 'Vendor Onboarding', 'setup@supplier-demo.com', 'Vendor setup', 'Could you share the W-9 and supporting documents for the vendor setup?'),
    m('d14', 't14', 50 * H, 'Accounting Today', 'news@accountingtoday-demo.com', 'This week in accounting', 'Top stories this week. Read more on our site.', { unsub: true, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
  ];
}
export const DEMO_VIPS = [{ id: 1, name: 'Mike', emails: 'mike@demo-client.com', alwaysHigh: false }, { id: 2, name: 'April', emails: 'april@demo-client.com', alwaysHigh: false }];
