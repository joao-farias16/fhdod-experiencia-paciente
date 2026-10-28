import { type RequestHandler, Router } from 'express';

import { requirePermission } from '../../middlewares/authorize.js';
import { parseInput } from '../../utils/validation.js';
import { auditContextOf, authOf } from '../auth/request-context.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamsSchema,
} from './users.schemas.js';
import {
  createUser,
  listUsers,
  resetUserPassword,
  updateUser,
  type UsersServiceDeps,
} from './users.service.js';

export interface UsersRoutesDeps extends UsersServiceDeps {
  ipSecret: string | undefined;
}

function usersController(deps: UsersRoutesDeps) {
  const list: RequestHandler = async (req, res) => {
    const filters = parseInput(listUsersQuerySchema, req.query);
    const { items, total } = await listUsers(deps.prisma, authOf(req), filters);
    res
      .status(200)
      .json({ data: items, meta: { page: filters.page, pageSize: filters.pageSize, total } });
  };

  const create: RequestHandler = async (req, res) => {
    const input = parseInput(createUserSchema, req.body);
    const result = await createUser(deps, authOf(req), auditContextOf(req, deps.ipSecret), input);
    res.status(201).json({ data: result });
  };

  const update: RequestHandler = async (req, res) => {
    const { id } = parseInput(userIdParamsSchema, req.params);
    const patch = parseInput(updateUserSchema, req.body);
    const user = await updateUser(deps, authOf(req), auditContextOf(req, deps.ipSecret), id, patch);
    res.status(200).json({ data: user });
  };

  const resetPassword: RequestHandler = async (req, res) => {
    const { id } = parseInput(userIdParamsSchema, req.params);
    const result = await resetUserPassword(
      deps,
      authOf(req),
      auditContextOf(req, deps.ipSecret),
      id,
    );
    res.status(200).json({ data: result });
  };

  return { list, create, update, resetPassword };
}

/** E06–E09 — administração de usuários (somente SA, Tabela 13). Montado em /admin. */
export function usersRouter(deps: UsersRoutesDeps): Router {
  const router = Router();
  const controller = usersController(deps);
  router.get('/users', requirePermission('E06'), controller.list);
  router.post('/users', requirePermission('E07'), controller.create);
  router.patch('/users/:id', requirePermission('E08'), controller.update);
  router.post('/users/:id/reset-password', requirePermission('E09'), controller.resetPassword);
  return router;
}
