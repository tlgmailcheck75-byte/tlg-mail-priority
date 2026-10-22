// Sample mail for demo mode (open the site with ?demo). Nothing is fetched from Gmail and nothing is saved.
const H = 3600_000;
export function demoMessages(now = Date.now()) {
  const m = (id, thread, ago, fromName, fromEmail, subject, body, extra = {}) => ({
    id, threadId: thread, historyId: 1, fromName, fromEmail, toLine: extra.to || 'tlgmailcheck75@gmail.com',
    subject, snippet: body.slice(0, 120), body, receivedAt: now - ago, labelIds: (extra.labels || ['INBOX']).join(','),
    attachments: (extra.atts || []).map((a) => `${a}|application/pdf|20480`).join('\n'), hasUnsubscribe: !!extra.unsub, isFromMe: !!extra.me,
  });
  return [
    m('d1', 't1', 0.2 * H, 'Bill.com', 'no-reply@hq.bill.com', 'Your Bill.com verification code', 'Your verification code is 482913. It expires in 10 minutes.', { to: 'tlgmailcheck75@gmail.com' }),
    m('d2', 't2', 1 * H, 'Mike', 'mike@demo-client.com', 'AR summary for this week', 'Hi team,\n\nCan you send me the AR summary for this week? Please include the open invoices over 60 days and the expected collection dates. I need it for the call with the client tomorrow morning.\n\nThanks,\nMike'),
    m('d3a', 't3', 30 * H, 'Rachel (Acme Corp)', 'ap@acme-demo.com', 'Invoice INV-2231 disputed', 'Hello,\n\nWe disagree with invoice INV-2231. We were overcharged for 12 hours and billed twice for the week of 6 October. Please issue a credit memo.\n\nRegards,\nRachel'),
    m('d3b', 't3', 26 * H, 'You', 'tlgmailcheck75@gmail.com', 'Re: Invoice INV-2231 disputed', 'Hi Rachel, thanks — checking the timesheets now and will revert today.\n\nOn Tue, Rachel wrote:\n> We disagree with invoice INV-2231.', { me: true, labels: ['SENT'] }),
    m('d3c', 't3', 3 * H, 'Rachel (Acme Corp)', 'ap@acme-demo.com', 'Re: Invoice INV-2231 disputed', 'Any update? This is now urgent, our finance team is escalating. Please send the corrected invoice by EOD.\n\nOn Wed, TLG wrote:\n> checking the timesheets now'),
    m('d4', 't4', 5 * H, 'Priya (HR)', 'hr@demo-client.com', 'Payroll inputs for week 42', 'Attached is the payroll register for approval. Devendra asked to close this before the payroll cutoff on Thursday.', { atts: ['payroll_register_w42.pdf'], to: 'Billing <billing@teamleadgeneration.com>' }),
    m('d5', 't5', 8 * H, 'Chase Bank', 'statements@chase-demo.com', 'September bank statement available', 'The bank reconciliation for September shows a difference of $1,250.00 versus the bank statement. Please review.'),
    m('d6', 't6', 20 * H, 'April', 'april@demo-client.com', 'Call center bonus — October', 'Hi, please calculate the call center bonus for October using the attached KPI sheet and send it for my approval. Make sure the new joiners are pro-rated.', { atts: ['kpi_october.xlsx'] }),
    m('d7', 't7', 40 * H, 'Vendor Co', 'ar@vendor-demo.com', 'Vendor statement for reconciliation', 'Please find our statement of account. Kindly confirm the balance and share the vendor reconciliation.'),
    m('d8', 't8', 50 * H, 'SaaS Weekly', 'news@saas-demo.com', 'Our autumn webinar series', 'Join our webinar on productivity tips. Click to register.', { unsub: true, labels: ['INBOX', 'CATEGORY_PROMOTIONS'] }),
  ];
}
export const DEMO_VIPS = [{ id: 1, name: 'Mike', emails: 'mike@demo-client.com', alwaysHigh: true }, { id: 2, name: 'April', emails: 'april@demo-client.com', alwaysHigh: true }];
