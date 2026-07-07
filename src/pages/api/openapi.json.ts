export const prerender = false;
import type { APIRoute } from 'astro';
import { basicAuthGuard } from '../../lib/basicAuth';

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Siddh Jyotish API',
    version: '1.0.0',
    description:
      'Public checkout endpoints, Stripe webhook, and protected admin pricing/orders APIs for Siddh Jyotish.',
  },
  servers: [{ url: '/' }],
  security: [],
  paths: {
    '/api/checkout/new': {
      post: {
        summary: 'Create a first-time Kundli checkout session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BirthDetailsInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Stripe Checkout session URL.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CheckoutUrlResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/checkout/followup': {
      post: {
        summary: 'Create a returning-customer follow-up checkout session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FollowupInput' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Stripe Checkout session URL.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CheckoutUrlResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
        },
      },
    },
    '/api/status': {
      get: {
        summary: 'Inspect checkout / report status by Stripe session id',
        parameters: [
          {
            name: 'session_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Payment/report state for the checkout session.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/StatusResponse' },
              },
            },
          },
          '400': {
            description: 'Missing session_id.',
          },
        },
      },
    },
    '/api/stripe/webhook': {
      post: {
        summary: 'Stripe webhook for completed checkout sessions',
        description:
          'Called by Stripe with a signed event payload. The webhook verifies the stripe-signature header before fulfilling the order.',
        security: [{ StripeSignature: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', additionalProperties: true },
            },
          },
        },
        responses: {
          '200': {
            description: 'Acknowledged.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookAck' },
              },
            },
          },
          '400': {
            description: 'Signature verification failed or payload was invalid.',
          },
        },
      },
    },
    '/api/admin/pricing': {
      get: {
        summary: 'Read the current runtime pricing config',
        security: [{ AdminBearer: [] }],
        responses: {
          '200': {
            description: 'Current pricing configuration.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PricingConfig' },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
      put: {
        summary: 'Update runtime pricing and currency',
        security: [{ AdminBearer: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PricingConfig' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Saved pricing configuration.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PricingConfig' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { description: 'KV not configured or persistence failed.' },
        },
      },
    },
    '/api/admin/orders': {
      get: {
        summary: 'Query persisted orders from Cloudflare KV',
        security: [{ AdminBearer: [] }],
        parameters: [
          {
            name: 'date',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '2026-07-07' },
            description: 'Single UTC day. Mutually exclusive with from/to.',
          },
          {
            name: 'from',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '2026-07-01' },
          },
          {
            name: 'to',
            in: 'query',
            required: false,
            schema: { type: 'string', example: '2026-07-31' },
          },
        ],
        responses: {
          '200': {
            description: 'Matching orders with totals by currency.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OrderQueryResponse' },
              },
            },
          },
          '400': { $ref: '#/components/responses/ValidationError' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '500': { description: 'KV not configured.' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      AdminBearer: {
        type: 'http',
        scheme: 'bearer',
      },
      StripeSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'stripe-signature',
      },
    },
    responses: {
      Unauthorized: {
        description: 'Missing or invalid credentials.',
        headers: {
          'WWW-Authenticate': {
            schema: { type: 'string' },
            description: 'Basic auth challenge.',
          },
        },
      },
      ValidationError: {
        description: 'Input validation failed.',
      },
    },
    schemas: {
      BirthDetailsInput: {
        type: 'object',
        additionalProperties: false,
        required: ['fullName', 'gender', 'dateOfBirth', 'timeOfBirth', 'placeOfBirth', 'email'],
        properties: {
          fullName: { type: 'string', maxLength: 120 },
          gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
          dateOfBirth: { type: 'string', maxLength: 40, examples: ['30 Jan 2000'] },
          timeOfBirth: { type: 'string', maxLength: 20, examples: ['11:30 PM'] },
          placeOfBirth: { type: 'string', maxLength: 160, examples: ['Toronto, Ontario, Canada'] },
          email: { type: 'string', format: 'email', maxLength: 200 },
          questions: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', maxLength: 140, description: 'Each question is capped at 18 words.' },
            default: [],
          },
        },
      },
      FollowupInput: {
        type: 'object',
        additionalProperties: false,
        required: ['reference', 'email', 'questions'],
        properties: {
          reference: { type: 'string', minLength: 10, maxLength: 4000 },
          email: { type: 'string', format: 'email', maxLength: 200 },
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', maxLength: 140, description: 'Each question is capped at 18 words.' },
          },
        },
      },
      CheckoutUrlResponse: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
        },
      },
      StatusResponse: {
        oneOf: [
          {
            type: 'object',
            required: ['state'],
            properties: {
              state: { const: 'unpaid' },
            },
          },
          {
            type: 'object',
            required: ['state'],
            properties: {
              state: { const: 'paid' },
              kind: { type: 'string', enum: ['kundli', 'followup'] },
              pandit: { type: 'string' },
              fullName: { type: 'string' },
            },
          },
        ],
      },
      WebhookAck: {
        type: 'object',
        required: ['received'],
        properties: {
          received: { type: 'boolean' },
        },
      },
      PricingConfig: {
        type: 'object',
        required: ['currency', 'kundliCents', 'followupTierCents'],
        properties: {
          currency: { type: 'string', minLength: 3, maxLength: 3 },
          kundliCents: { type: 'integer', minimum: 1 },
          followupTierCents: {
            type: 'object',
            required: ['1', '2', '3'],
            properties: {
              '1': { type: 'integer', minimum: 1 },
              '2': { type: 'integer', minimum: 1 },
              '3': { type: 'integer', minimum: 1 },
            },
            additionalProperties: false,
          },
        },
      },
      OrderRecord: {
        type: 'object',
        required: ['id', 'kind', 'amountTotal', 'currency', 'email', 'createdAt', 'createdAtMs'],
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['kundli', 'followup'] },
          amountTotal: { type: 'integer', minimum: 0 },
          currency: { type: 'string' },
          email: { type: 'string' },
          fullName: { type: 'string' },
          questionCount: { type: 'integer', minimum: 0 },
          createdAt: { type: 'string', format: 'date-time' },
          createdAtMs: { type: 'integer' },
        },
      },
      OrderQueryResponse: {
        type: 'object',
        required: ['from', 'to', 'count', 'totalsByCurrency', 'orders'],
        properties: {
          from: { type: ['string', 'null'], format: 'date-time' },
          to: { type: ['string', 'null'], format: 'date-time' },
          count: { type: 'integer', minimum: 0 },
          totalsByCurrency: {
            type: 'object',
            additionalProperties: { type: 'integer', minimum: 0 },
          },
          orders: {
            type: 'array',
            items: { $ref: '#/components/schemas/OrderRecord' },
          },
        },
      },
    },
  },
} as const;

export const GET: APIRoute = async ({ request }) => {
  const auth = basicAuthGuard(request);
  if (auth) return auth;

  return new Response(JSON.stringify(spec), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
