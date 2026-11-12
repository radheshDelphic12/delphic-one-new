const { defaultEmailFor } = require('../src/lib/notifications/eventCatalog');

describe('notification email default', () => {
  test('interview and offer mails are on by default for the people involved', () => {
    expect(defaultEmailFor('interview_scheduled', 'recruiter')).toBe(true);
    expect(defaultEmailFor('interview_reminder', 'sales')).toBe(true);
    expect(defaultEmailFor('candidate_offer', 'bda')).toBe(true);
  });

  test('admins, who are copied on every event, only get mail once they opt in', () => {
    expect(defaultEmailFor('interview_scheduled', 'admin')).toBe(false);
    expect(defaultEmailFor('interview_reminder', 'admin')).toBe(false);
    expect(defaultEmailFor('candidate_offer', 'admin')).toBe(false);
  });

  test('events without email stay off', () => {
    expect(defaultEmailFor('candidate_rejected', 'recruiter')).toBe(false);
  });
});
