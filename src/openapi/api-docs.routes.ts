import { type RequestHandler, Router } from 'express';
import helmet from 'helmet';
import swaggerUi, { type SwaggerUiOptions } from 'swagger-ui-express';

import { buildOpenApiDocument, type OpenApiDocument } from './document.js';

/** Rota da documentação interativa (Swagger UI). */
export const API_DOCS_PATH = '/api-docs';
/** Documento OpenAPI 3.1 em JSON, para ferramentas e clientes. */
export const OPENAPI_JSON_PATH = `${API_DOCS_PATH}/openapi.json`;

const UI_OPTIONS: SwaggerUiOptions = {
  customSiteTitle: 'API FHDOD — Swagger',
  swaggerOptions: {
    // Sem o selo do validador externo (validator.swagger.io), bloqueado pela CSP do helmet.
    validatorUrl: null,
    docExpansion: 'list',
    tryItOutEnabled: false,
  },
};

/**
 * CSP padrão do helmet sem `upgrade-insecure-requests`, somente nas páginas da documentação: em
 * HTTP local, o Safari/WebKit aplicaria a diretiva também a `localhost` e pediria os arquivos do
 * Swagger UI por HTTPS (página em branco). Em produção a API já é servida por HTTPS (HSTS) e todos
 * os recursos da página são da própria origem; as rotas /api/v1 mantêm a CSP global inalterada.
 */
const docsContentSecurityPolicy = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: { upgradeInsecureRequests: null },
});

let cachedDocument: OpenApiDocument | undefined;

/** O documento é estático: gerado uma vez por processo. */
export function openApiDocument(): OpenApiDocument {
  cachedDocument ??= buildOpenApiDocument();
  return cachedDocument;
}

/**
 * GET /api-docs (Swagger UI) e GET /api-docs/openapi.json (documento). Os arquivos do Swagger UI
 * são servidos pela própria API (`swagger-ui-dist`), sem CDN: funcionam com a CSP do helmet
 * (scripts somente de 'self'). `serveFiles` evita o estado global de `swaggerUi.serve`.
 */
export function apiDocsRouter(): Router {
  const document = openApiDocument();
  const router = Router();

  const sendDocument: RequestHandler = (_req, res) => {
    res.status(200).json(document);
  };

  router.get(OPENAPI_JSON_PATH, sendDocument);
  router.use(
    API_DOCS_PATH,
    docsContentSecurityPolicy,
    swaggerUi.serveFiles(document, UI_OPTIONS),
    swaggerUi.setup(document, UI_OPTIONS),
  );
  return router;
}
