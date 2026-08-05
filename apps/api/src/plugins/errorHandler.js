import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';

/**
 * Egységes hibaformátum minden route-ra: { error: { code, message, details? } }.
 * @param {import('fastify').FastifyInstance} fastify
 */
function errorHandlerPlugin(fastify) {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Érvénytelen bemenet.',
          details: error.issues,
        },
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          details: error.validation,
        },
      });
      return;
    }

    // Plugin-ek (pl. @fastify/rate-limit) által dobott hibák sima Error
    // instance-ok explicit statusCode mezővel, AppError öröklés nélkül.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: { code: error.code ?? 'REQUEST_ERROR', message: error.message },
      });
      return;
    }

    request.log.error({ err: error }, 'Kezelt kivétel nélküli hiba');
    reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Váratlan szerverhiba történt.' },
    });
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: { code: 'NOT_FOUND', message: `Nem található: ${request.method} ${request.url}` },
    });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
