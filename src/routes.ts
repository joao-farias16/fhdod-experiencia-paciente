import { type RequestHandler, Router } from 'express';

import type { Database } from './lib/database.js';
import { profileRateLimit } from './middlewares/rate-limit.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { authenticate, requirePasswordChanged } from './modules/auth/auth.middleware.js';
import { authRouter } from './modules/auth/auth.routes.js';
import type { AuthConfig } from './modules/auth/auth.types.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import {
  ombudsmanRouter,
  publicManifestationRouter,
} from './modules/manifestations/manifestations.routes.js';
import { publicSurveyRouter } from './modules/public-survey/public-survey.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { sectorsRouter } from './modules/sectors/sectors.routes.js';
import { shiftsRouter } from './modules/shifts/shifts.routes.js';
import { surveysRouter } from './modules/surveys/surveys.routes.js';
import { teamsRouter } from './modules/teams/teams.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import type { Clock } from './utils/dates.js';

export interface V1Deps {
  clock: Clock;
  db: Database;
  authConfig: AuthConfig;
  ipSecret: string | undefined;
  publicAppUrl: string;
  manifestationTokenSecret: string;
}

/**
 * Agrega as rotas da versão 1 da API, montadas em /api/v1. Cadeia das rotas autenticadas
 * (Seção 6): authenticate → limite de 300/min por perfil → requirePasswordChanged (exceto E04, E05
 * e E46) → requirePermission → serviços com o escopo de req.auth.
 */
export function v1Router({
  clock,
  db,
  authConfig,
  ipSecret,
  publicAppUrl,
  manifestationTokenSecret,
}: V1Deps): Router {
  const router = Router();
  const authChain: RequestHandler[] = [
    authenticate({ db, config: authConfig, clock }),
    profileRateLimit({ windowMs: 60_000, limit: 300 }),
  ];

  router.use(healthRouter({ clock, db }));
  // Pesquisa pública (E01, E02) e manifestação (E03): sem autenticação e sem cookies.
  router.use(publicSurveyRouter({ db, clock, manifestationTokenSecret }));
  router.use(publicManifestationRouter({ db, clock, manifestationTokenSecret }));
  // Autenticação própria (E44–E46) e perfil (E04, E05).
  router.use(authRouter({ db, config: authConfig, clock, authChain, ipSecret }));

  const admin = Router();
  admin.use(...authChain, requirePasswordChanged);
  admin.use(usersRouter({ db, authConfig, clock, ipSecret }));
  admin.use(sectorsRouter({ db, clock, ipSecret }));
  admin.use(teamsRouter({ db, clock, ipSecret }));
  admin.use(shiftsRouter({ db, clock, ipSecret }));
  admin.use(surveysRouter({ db, clock, ipSecret, publicAppUrl }));
  admin.use(auditRouter({ db, clock }));
  router.use('/admin', admin);

  // ET07–ET09: Ouvidoria (E35–E40), dashboard (E28–E33) e relatórios Excel (E34).
  const authenticated = (child: Router) => {
    const wrapper = Router();
    wrapper.use(...authChain, requirePasswordChanged, child);
    return wrapper;
  };
  router.use('/ouvidoria', authenticated(ombudsmanRouter({ db, clock, ipSecret })));
  router.use('/dashboard', authenticated(dashboardRouter({ db, clock })));
  router.use('/reports', authenticated(reportsRouter({ db, clock, ipSecret })));

  return router;
}
