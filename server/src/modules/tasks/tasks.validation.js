const { z } = require('zod');
const { optionalDate } = require('../../lib/zodDate');

const STATUS = z.enum(['pending', 'in_progress', 'completed']);

const createTaskSchema = z.object({
  account_id: z.string().uuid(),
  assignee_membership_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  due_date: optionalDate,
});

// Admin-only patch — any field. A plain assignee uses updateTaskStatusSchema
// instead (see tasks.routes.js), never this one.
const updateTaskSchema = z.object({
  account_id: z.string().uuid().optional(),
  assignee_membership_id: z.string().uuid().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  status: STATUS.optional(),
  due_date: optionalDate,
});

const updateTaskStatusSchema = z.object({
  status: STATUS,
});

const listTasksQuerySchema = z.object({
  status: STATUS.optional(),
  assignee_membership_id: z.string().uuid().optional(),
  account_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const listMineQuerySchema = z.object({
  status: STATUS.optional(),
});

module.exports = {
  createTaskSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  listTasksQuerySchema,
  listMineQuerySchema,
};
