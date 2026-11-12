# Log time page (IT timesheet)

Files: `client/src/pages/time/ItTimesheetPage.jsx`, `client/src/components/NoteText.jsx`.

- **Order:** the month's days are listed newest first (also under the week / project filters).
- **Description markup:** plain text with light markup, rendered by `NoteText` as React elements (never raw HTML):
  `**bold**`, `*italic*`, `` `code` ``, `- bullets`, `[label](https://...)`, bare `https://` links.
  Stored as typed, so approvals and the Excel export stay readable.
- **Editor:** toolbar B / I / List / Link (toggle on and off), Ctrl+B / Ctrl+I, live "Preview" panel under the box
  (`MarkupPreview`, shown only when the text contains markup).
- **Layout:** each day's table uses fixed column widths (Project 18%, Hours 9%, Status 25%, Description the rest) so
  days line up; the Date field sits in its own card with a hint.
- `NoteText` is shared: other screens that use it render the same markup.

Staging demo rows for Radhesh Shrivastav start with `[demo] ` in the description (delete by that prefix).
