import { Router } from 'express';
import { orderController } from '../controllers/order.controller';
import { batchController } from '../controllers/batch.controller';
import { validateSingleOrder, validateBulkOrders } from '../middlewares/validate.middleware';

const router = Router();

// Single Order endpoints
router.post('/', validateSingleOrder, orderController.createOrder);
router.get('/:order_id/track', orderController.trackOrder);
router.post('/:order_id/cancel', orderController.cancelOrder);

// Bulk Order endpoints
router.post('/bulk', validateBulkOrders, batchController.createBatch);
router.get('/bulk/:batch_id', batchController.getBatchStatus);

export const orderRouter = router;
