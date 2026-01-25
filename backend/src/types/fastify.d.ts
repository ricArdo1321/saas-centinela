import 'fastify';

declare module 'fastify' {
    interface FastifyInstance {
        verifyAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        verifyApiKey: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    }

    interface FastifyRequest {
        user?: {
            id: string;
            email: string;
            tenantId: string;
        };
        tenantId?: string; // For API Key auth
    }
}
