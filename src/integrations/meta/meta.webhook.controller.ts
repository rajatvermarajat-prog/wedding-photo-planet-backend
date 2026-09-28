import { Request } from 'express';
import { asyncHandler } from '../../utils/http';
import { sendSuccess } from '../../utils/response';
import * as service from './meta.webhook.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

export const verifyWebhook = asyncHandler(async (req, res) => {
  const challenge = service.verifyChallenge(req.query);
  return res.status(200).type('text/plain').send(challenge);
});

export const receiveWebhook = asyncHandler(async (req: RawBodyRequest, res) => {
  const signature = req.header('x-hub-signature-256') ?? undefined;
  service.assertValidSignature(req.rawBody, signature);
  return sendSuccess(res, await service.processWebhookPayload(req.body));
});
