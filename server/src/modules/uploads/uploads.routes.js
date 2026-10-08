const express = require('express');
const { authenticate } = require('../../middleware/auth');
const { fail } = require('../../utils/response');
const asyncHandler = require('../../utils/asyncHandler');
const service = require('./uploads.service');

// Replaces the old `express.static` mount on /uploads, which served every
// stored file (CVs, agreements, receipts) to any holder of a valid token —
// ex-employees and other companies' users included. Each download is now
// authorized against the Document / ProjectDocument row that owns the file.
const ERROR_STATUS = {
  membership_required: [403, 'Active organization membership required'],
  forbidden: [403, 'Not permitted'],
  not_found: [404, 'File not found'],
};

const router = express.Router();
router.use(authenticate);

router.get(
  '/:filename',
  asyncHandler(async (req, res) => {
    const result = await service.resolveFile(req.params.filename, req.user);
    if (result.error) {
      const [status, message] = ERROR_STATUS[result.error];
      return fail(res, status, message);
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    // Attachment, never inline: an uploaded file must not render as a page
    // on the API origin. The SPA fetches it as a blob, so this costs nothing.
    res.attachment(result.downloadName);
    return res.sendFile(result.filename, { root: result.root, dotfiles: 'deny' });
  })
);

module.exports = router;
