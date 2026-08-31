import { asyncHandler, requireAuthContext } from '../utils/http';
import { sendSuccess } from '../utils/response';
import * as dashboardService from '../services/dashboard.service';

export const summary = asyncHandler(async (req, res) => {
  const auth = requireAuthContext(req);
  return sendSuccess(res, await dashboardService.getSummary(auth));
});
