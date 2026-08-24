import { Router } from 'express';
import * as controller from '../controllers/auth.controller';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { changePasswordSchema, loginSchema, refreshSchema } from '../validators/auth.validator';

const router = Router();

router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
router.post('/refresh', authLimiter, validate({ body: refreshSchema }), controller.refresh);

router.use(requireAuth);
router.post('/logout', controller.logout);
router.get('/me', controller.me);
router.get('/sessions', controller.sessions);
router.post('/sessions/revoke-all', controller.revokeSessions);
router.post(
  '/change-password',
  authLimiter,
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);

export default router;
