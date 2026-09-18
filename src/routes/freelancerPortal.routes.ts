import { Router } from 'express';
import * as controller from '../controllers/freelancerPortal.controller';
import { authLimiter } from '../middleware/rateLimiter';
import { requireFreelancerAuth } from '../middleware/freelancerAuth';
import { validate } from '../middleware/validate';
import {
  freelancerPortalLoginSchema,
  freelancerPortalRefreshSchema,
  freelancerProfileUpdateSchema,
  itemIdParam,
  portalAvailabilitySchema,
  portalPortfolioCreateSchema,
  portalPortfolioUpdateSchema,
  publicFreelancerApplicationSchema,
  setFreelancerPasswordSchema,
} from '../validators/freelancerPortal.validator';

const router = Router();

router.post('/applications', validate({ body: publicFreelancerApplicationSchema }), controller.submitApplication);
router.post('/auth/login', authLimiter, validate({ body: freelancerPortalLoginSchema }), controller.login);
router.post('/auth/refresh', authLimiter, validate({ body: freelancerPortalRefreshSchema }), controller.refresh);

router.use(requireFreelancerAuth);
router.post('/auth/logout', controller.logout);
router.get('/me', controller.me);
router.patch('/profile', validate({ body: freelancerProfileUpdateSchema }), controller.updateProfile);
router.post('/password', authLimiter, validate({ body: setFreelancerPasswordSchema }), controller.setPassword);
router.put('/availability', validate({ body: portalAvailabilitySchema }), controller.upsertAvailability);
router.post('/portfolio', validate({ body: portalPortfolioCreateSchema }), controller.createPortfolioItem);
router.patch('/portfolio/:itemId', validate({ params: itemIdParam, body: portalPortfolioUpdateSchema }), controller.updatePortfolioItem);
router.delete('/portfolio/:itemId', validate({ params: itemIdParam }), controller.deletePortfolioItem);
router.get('/plans', controller.listPlans);

export default router;
