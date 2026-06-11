import request from 'supertest';
import { app, server } from '../app';
import { queueService } from '../services/queue.service';
import { prisma } from '../services/prisma';

// Helper for delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  // Clear test tables to keep test runs clean and reproducible
  await prisma.trackingHistory.deleteMany();
  await prisma.order.deleteMany();
  await prisma.bulkBatchItem.deleteMany();
  await prisma.bulkBatch.deleteMany();
});

afterAll(async () => {
  // Clean up server, timers, and database connections to allow Jest to exit
  queueService.stopPolling();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
});

describe('Multi-Courier Platform REST API Integration Tests', () => {
  const baseOrderPayload = {
    declared_value: 1500,
    collectable_value: 0,
    item_description: 'Running Shoes',
    item_quantity: 1,
    pay_mode: 'PPD',
    weight: 0.8,
    length: 15,
    breadth: 12,
    height: 10,
    pieces: 1,
    shipper: {
      name: 'Alpha Warehouse',
      mobile: '9876543210',
      email: 'shipper@alpha.com',
      address: 'Industrial Area Phase 1',
      city: 'Gurgaon',
      state: 'Haryana',
      pincode: '122001',
      country: 'INDIA'
    },
    consignee: {
      name: 'John Doe',
      mobile: '9999988888',
      email: 'john.doe@gmail.com',
      address: 'Flat 402, Green Meadows Apartment',
      city: 'Surat',
      state: 'Gujarat',
      pincode: '395009',
      country: 'INDIA'
    },
    invoice_number: 'INV-2026-001',
    invoice_date: '2026-06-11',
    invoice_value: 1500
  };

  describe('Single Order lifecycle', () => {
    const orderId = 'TEST_ORD_' + Date.now();

    it('should fail creation on validation errors (missing fields)', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .send({
          order_id: orderId,
          courier_partner: 'mock'
          // missing required fields like weight, invoice details, etc.
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.details.length).toBeGreaterThan(0);
    });

    it('should successfully create an order using the pluggable MockCourier', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .send({
          order_id: orderId,
          courier_partner: 'mock',
          ...baseOrderPayload
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.order_id).toBe(orderId);
      expect(response.body.data.courier_partner).toBe('mock');
      expect(response.body.data.awb).toBeDefined();
      expect(response.body.data.status).toBe('CREATED');
    });

    it('should enforce idempotency by returning the cached order on duplicate submissions', async () => {
      const response = await request(app)
        .post('/api/v1/orders')
        .send({
          order_id: orderId,
          courier_partner: 'mock',
          ...baseOrderPayload
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.order_id).toBe(orderId);
    });

    it('should track a manifested order and return tracking events', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${orderId}/track`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.orderId).toBe(orderId);
      expect(response.body.data.status).toBe('IN_TRANSIT');
      expect(response.body.data.trackingHistory.length).toBeGreaterThan(0);
    });

    it('should cancel the manifested order', async () => {
      const response = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Cancellation confirmed');

      // Verify DB status has updated to CANCELLED
      const dbOrder = await prisma.order.findUnique({ where: { orderId } });
      expect(dbOrder?.status).toBe('CANCELLED');
    });
  });

  describe('Bulk Order lifecycle', () => {
    it('should accept bulk order payload and return batch_id immediately', async () => {
      const uniqueBatchId = 'BATCH_' + Date.now();
      const bulkPayload = [
        {
          order_id: `${uniqueBatchId}_O1`,
          courier_partner: 'mock',
          ...baseOrderPayload
        },
        {
          order_id: `${uniqueBatchId}_O2`,
          courier_partner: 'mock',
          ...baseOrderPayload
        },
        {
          // This one is designed to fail using mock adapter failure hook
          order_id: `${uniqueBatchId}_O3_FAIL`,
          courier_partner: 'mock',
          ...baseOrderPayload
        }
      ];

      const response = await request(app)
        .post('/api/v1/orders/bulk')
        .send(bulkPayload);

      expect(response.status).toBe(202);
      expect(response.body.success).toBe(true);
      expect(response.body.data.batch_id).toBeDefined();
      expect(response.body.data.status).toBe('PENDING');

      const batchId = response.body.data.batch_id;

      // Force background queue processing immediately instead of waiting for interval
      await queueService.trigger();

      // Poll until the background processing completes (up to 2 seconds)
      let statusResponse: any;
      for (let i = 0; i < 20; i++) {
        statusResponse = await request(app).get(`/api/v1/orders/bulk/${batchId}`);
        if (statusResponse.body.data.status === 'COMPLETED') {
          break;
        }
        await delay(100);
      }

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.body.success).toBe(true);
      expect(statusResponse.body.data.status).toBe('COMPLETED');
      expect(statusResponse.body.data.total_count).toBe(3);
      expect(statusResponse.body.data.success_count).toBe(2);
      expect(statusResponse.body.data.failed_count).toBe(1);

      // Verify detailed per-order results
      const results = statusResponse.body.data.results;
      const o1 = results.find((r: any) => r.order_id === `${uniqueBatchId}_O1`);
      const o3 = results.find((r: any) => r.order_id === `${uniqueBatchId}_O3_FAIL`);

      expect(o1.status).toBe('SUCCESS');
      expect(o1.awb).toBeDefined();
      expect(o3.status).toBe('FAILED');
      expect(o3.error_reason).toContain('check failed');
    });
  });
});
