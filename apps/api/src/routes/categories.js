import { categoryResponseSchema, updateCategoryBodySchema } from '@filler/shared';
import * as categoryService from '../services/categoryService.js';
import { idParamsSchema } from '../schemas/params.js';

/**
 * @param {import('fastify').FastifyInstance} fastify
 */
export default function categoriesRoutes(fastify) {
  fastify.patch(
    '/:id',
    {
      schema: {
        params: idParamsSchema,
        body: updateCategoryBodySchema,
        response: { 200: categoryResponseSchema },
      },
    },
    (request) => {
      return categoryService.updateCategory(request.params.id, request.body);
    },
  );

  fastify.delete('/:id', { schema: { params: idParamsSchema } }, async (request, reply) => {
    await categoryService.deleteCategory(request.params.id);
    return reply.status(204).send();
  });
}
