function ok(res, data, extra = {}, status = 200) {
  return res.status(status).json({ success: true, data, ...extra });
}

function created(res, data, extra = {}) {
  return ok(res, data, extra, 201);
}

function fail(res, status, message, errors) {
  return res.status(status).json({ success: false, message, ...(errors ? { errors } : {}) });
}

module.exports = { ok, created, fail };
