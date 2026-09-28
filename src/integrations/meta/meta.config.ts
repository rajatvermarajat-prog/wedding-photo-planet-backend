import { env } from '../../config/env';
import { badRequest } from '../../utils/errors';

export function requireMetaConfig() {
  const missing = [
    ['META_APP_SECRET', env.META_APP_SECRET],
    ['META_PAGE_ID', env.META_PAGE_ID],
    ['META_PAGE_ACCESS_TOKEN', env.META_PAGE_ACCESS_TOKEN],
    ['META_WEBHOOK_VERIFY_TOKEN', env.META_WEBHOOK_VERIFY_TOKEN],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw badRequest('Meta Lead Ads integration is not configured', missing.map(([field]) => ({
      field,
      message: 'Required',
    })));
  }

  return {
    appSecret: env.META_APP_SECRET as string,
    graphApiVersion: env.META_GRAPH_API_VERSION,
    pageAccessToken: env.META_PAGE_ACCESS_TOKEN as string,
    pageId: env.META_PAGE_ID as string,
    verifyToken: env.META_WEBHOOK_VERIFY_TOKEN as string,
  };
}
