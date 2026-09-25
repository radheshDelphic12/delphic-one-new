const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/response');
const service = require('./notifications.service');
const { listQuerySchema, readSchema, preferencesSchema } = require('./notifications.validation');

const list = asyncHandler(async (req, res) => {
  const query = listQuerySchema.parse(req.query);
  const result = await service.list(req.user.id, query);
  return ok(res, result.items, { has_more: result.has_more, next_cursor: result.next_cursor });
});

const unreadCount = asyncHandler(async (req, res) => {
  return ok(res, await service.unreadCount(req.user.id));
});

const markRead = asyncHandler(async (req, res) => {
  const { ids } = readSchema.parse(req.body);
  return ok(res, await service.markRead(req.user.id, ids));
});

const markAllRead = asyncHandler(async (req, res) => {
  return ok(res, await service.markAllRead(req.user.id));
});

const getPreferences = asyncHandler(async (req, res) => {
  return ok(res, await service.getPreferences(req.user));
});

const setPreferences = asyncHandler(async (req, res) => {
  const { items } = preferencesSchema.parse(req.body);
  return ok(res, await service.setPreferences(req.user, items));
});

const resetPreferences = asyncHandler(async (req, res) => {
  return ok(res, await service.resetPreferences(req.user));
});

module.exports = {
  list,
  unreadCount,
  markRead,
  markAllRead,
  getPreferences,
  setPreferences,
  resetPreferences,
};
