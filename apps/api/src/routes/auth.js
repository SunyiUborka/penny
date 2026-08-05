import { z } from 'zod';
import { LOGIN_RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW } from '../config/auth.js';
import { UnauthorizedError } from '../errors.js';
import {
  clearSessionCookie,
  isRequestAuthenticated,
  setSessionCookie,
  verifyPassword,
} from '../services/authService.js';
import {
  getLoginDelayMs,
  recordFailedLoginAttempt,
  resetLoginAttempts,
} from '../services/loginAttemptTracker.js';

const loginBodySchema = z.object({ password: z.string().min(1) });
const authStatusResponseSchema = z.object({ authenticated: z.boolean() });

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function authRoutes(fastify) {
  fastify.post(
    '/login',
    {
      schema: { body: loginBodySchema, response: { 200: authStatusResponseSchema } },
      config: { rateLimit: { max: LOGIN_RATE_LIMIT_MAX, timeWindow: LOGIN_RATE_LIMIT_WINDOW } },
    },
    async (request, reply) => {
      const { password } = request.body;
      const { ip } = request;

      const delayMs = getLoginDelayMs(ip);
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      const valid = await verifyPassword(password);
      if (!valid) {
        recordFailedLoginAttempt(ip);
        throw new UnauthorizedError('Hibás jelszó.');
      }

      resetLoginAttempts(ip);
      setSessionCookie(reply, request.protocol === 'https');
      return { authenticated: true };
    },
  );

  fastify.post(
    '/logout',
    { schema: { response: { 200: authStatusResponseSchema } } },
    (request, reply) => {
      clearSessionCookie(reply, request.protocol === 'https');
      return { authenticated: false };
    },
  );

  fastify.get('/me', { schema: { response: { 200: authStatusResponseSchema } } }, (request) => {
    return { authenticated: isRequestAuthenticated(request) };
  });
}
