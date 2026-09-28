import { Router } from 'express';
import * as metaWebhookController from '../integrations/meta/meta.webhook.controller';

export const metaIntegrationRouter = Router();

metaIntegrationRouter.get('/webhook', metaWebhookController.verifyWebhook);
metaIntegrationRouter.post('/webhook', metaWebhookController.receiveWebhook);
