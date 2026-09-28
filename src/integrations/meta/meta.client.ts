import { logger } from '../../config/logger';
import { AppError, badRequest } from '../../utils/errors';
import { MetaLeadDetails } from './meta.types';

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchMetaLeadDetails(
  leadgenId: string,
  config: { graphApiVersion: string; pageAccessToken: string },
): Promise<MetaLeadDetails> {
  const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(leadgenId)}`);
  url.searchParams.set('fields', 'id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,page_id');
  url.searchParams.set('access_token', config.pageAccessToken);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.json().catch(() => ({})) as MetaLeadDetails & { error?: { code?: string } };
      if (!response.ok) {
        logger.warn({ leadgenId, status: response.status, metaError: body?.error?.code, attempt }, 'Meta lead retrieval failed');
        if (attempt === 1 && RETRYABLE_STATUSES.has(response.status)) {
          await sleep(250);
          continue;
        }
        throw response.status === 401 || response.status === 403
          ? new AppError(401, 'UNAUTHENTICATED', 'Meta Page access token is invalid or expired')
          : badRequest('Unable to retrieve Meta lead details');
      }
      if (!body.id || !Array.isArray(body.field_data)) {
        throw badRequest('Meta lead details response is malformed');
      }
      return body;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn({ leadgenId, attempt }, 'Meta lead retrieval timed out');
        if (attempt === 1) {
          await sleep(250);
          continue;
        }
        throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Meta lead retrieval timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Meta lead retrieval failed');
}
