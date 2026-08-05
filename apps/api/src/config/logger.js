/**
 * Pino logger opciók. Fejlesztésben szép, olvasható kimenet; prodban sima
 * JSON, amit a log-aggregátor fel tud dolgozni.
 * @param {'development' | 'production' | 'test'} nodeEnv
 * @returns {import('fastify').FastifyServerOptions['logger']}
 */
export function buildLoggerOptions(nodeEnv) {
  if (nodeEnv === 'test') {
    return false;
  }
  if (nodeEnv === 'development') {
    return {
      level: 'debug',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    };
  }
  return { level: 'info' };
}
