import {
  createPersonBodySchema,
  personListResponseSchema,
  personResponseSchema,
  updatePersonBodySchema,
} from '@filler/shared';
import * as personService from '../services/personService.js';
import { idParamsSchema } from '../schemas/params.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function peopleRoutes(fastify) {
  fastify.get('/', { schema: { response: { 200: personListResponseSchema } } }, () => {
    return personService.listPeople();
  });

  fastify.post(
    '/',
    { schema: { body: createPersonBodySchema, response: { 201: personResponseSchema } } },
    async (request, reply) => {
      const person = await personService.createPerson(request.body);
      return reply.status(201).send(person);
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        params: idParamsSchema,
        body: updatePersonBodySchema,
        response: { 200: personResponseSchema },
      },
    },
    (request) => {
      return personService.updatePerson(request.params.id, request.body);
    },
  );

  fastify.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await personService.deletePerson(request.params.id);
    return reply.status(204).send();
  });
}
