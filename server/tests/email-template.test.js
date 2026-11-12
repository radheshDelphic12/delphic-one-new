/**
 * The HTML layout of every outgoing email (lib/email/template.js): pure functions, no database.
 */
const { renderEmailHtml } = require('../src/lib/email/template');

describe('email template', () => {
  test('a candidate invitation: heading, greeting, a button for the link with the raw link under it, and a sign-off', () => {
    const html = renderEmailHtml({
      subject: 'Your interview for Java Developer',
      kind: 'ai_interview_invite',
      text: 'Hi Asha,\n\nPlease complete this short online interview: https://one.delphic.in/ai-interview/abc123\n\nThe link is valid for 7 days.\n\nThank you,\nDelphic Team',
    });
    expect(html).toContain('<h1');
    expect(html).toContain('Your interview for Java Developer');
    expect(html).toContain('Hi Asha,');
    expect(html).toMatch(/<a href="https:\/\/one\.delphic\.in\/ai-interview\/abc123"[^>]*>Start your interview<\/a>/);
    // the raw link stays visible for mail apps that block buttons, and the sentence loses it
    expect(html).toContain('copy this link into your browser');
    expect(html).toContain('Please complete this short online interview.');
    expect(html).toContain('Thank you,<br>Delphic Team');
  });

  test('"Label: value" lines become a details table, with a heading line above them', () => {
    const html = renderEmailHtml({
      subject: 'Requirement: Java Developer',
      kind: 'vendor_requirements',
      text: 'Hello,\n\nWe have the following requirement.\n\nJava Developer (2 openings)\n   Experience: 3-5 years\n   Skills: Java, Spring\n\nPlease reply with profiles.\n\nThanks,\nRadhesh',
    });
    expect(html).toContain('<strong>Java Developer (2 openings)</strong>');
    expect(html).toMatch(/<table[^>]*>.*Experience.*3-5 years.*Skills.*Java, Spring.*<\/table>/s);
    expect(html).toContain('Thanks,<br>Radhesh');
  });

  test('a leave request: the first line stays a paragraph, the detail lines become a table', () => {
    const html = renderEmailHtml({ subject: 'Leave request: Asha', kind: 'leave_applied', text: 'Asha has applied for leave.\n\nCasual Leave: 3 Nov to 4 Nov\nReason: Family event\nApplied by: Asha\n\nOpen Leave > Team requests in Delphic One to approve or reject it.' });
    expect(html).toContain('Asha has applied for leave.');
    expect(html).toMatch(/Casual Leave.*3 Nov to 4 Nov.*Reason.*Family event/s);
    expect(html).toContain('Open Leave &gt; Team requests');
  });

  test('user text is escaped and never becomes markup; links in a plain paragraph are clickable', () => {
    const html = renderEmailHtml({ subject: 'Hello <b>', kind: 'x', text: '<script>alert(1)</script> & "quotes"\n\nSee https://example.com/a?b=1&c=2.' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Hello &lt;b&gt;');
    expect(html).toContain('&amp;');
    // the full stop after the link is not part of it
    expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"');
  });

  test('a text with no structure still reads as paragraphs with line breaks', () => {
    const html = renderEmailHtml({ subject: 'Update', text: 'Line one\nLine two\n\nSecond paragraph' });
    expect(html).toContain('Line one<br>Line two');
    expect(html).toContain('Second paragraph');
    expect(html).toContain('This email was sent by Delphic');
  });
});
