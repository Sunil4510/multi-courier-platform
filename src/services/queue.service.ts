import { prisma } from './prisma';
import { orderService } from './order.service';
import { env } from '../config/env';
import pLimit from 'p-limit';

export class QueueService {
  private isProcessing = false;
  private pollInterval: NodeJS.Timeout | null = null;

  public startPolling() {
    if (this.pollInterval) return;

    console.log(`Starting background queue poll loop every ${env.QUEUE_POLL_INTERVAL_MS}ms`);
    this.pollInterval = setInterval(() => {
      this.trigger().catch((err) => {
        console.error('Queue poll trigger failed:', err.message);
      });
    }, env.QUEUE_POLL_INTERVAL_MS);
  }

  public stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('Stopped background queue poll loop');
    }
  }

  /**
   * Main entry point to wake up the queue processor.
   * Uses an in-memory lock to prevent overlapping runs.
   */
  public async trigger() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      await this.processQueue();
    } finally {
      this.isProcessing = false;
    }
  }

  private async processQueue() {
    const limit = pLimit(env.CONCURRENCY_LIMIT);

    while (true) {
      // 1. Transactionally fetch and "lock" a batch of PENDING items
      const itemsToProcess = await prisma.$transaction(async (tx) => {
        // Find all orderIds currently being processed
        const activeProcessingItems = await tx.bulkBatchItem.findMany({
          where: { status: 'PROCESSING' },
          select: { orderId: true }
        });
        const activeOrderIds = activeProcessingItems.map(item => item.orderId);

        // Fetch candidate pending items whose orderIds are not active
        const pendingCandidates = await tx.bulkBatchItem.findMany({
          where: {
            status: 'PENDING',
            ...(activeOrderIds.length > 0 ? { orderId: { notIn: activeOrderIds } } : {})
          },
          orderBy: { createdAt: 'asc' },
          take: 200 // Fetch a reasonable chunk to deduplicate in memory
        });

        if (pendingCandidates.length === 0) return [];

        // Deduplicate candidates in-memory to ensure we don't process same orderId in parallel
        const pendingItems: typeof pendingCandidates = [];
        const seen = new Set<string>();
        for (const item of pendingCandidates) {
          if (!seen.has(item.orderId)) {
            seen.add(item.orderId);
            pendingItems.push(item);
            if (pendingItems.length >= env.CONCURRENCY_LIMIT) {
              break;
            }
          }
        }

        if (pendingItems.length === 0) return [];

        const ids = pendingItems.map(item => item.id);
        const batchIds = Array.from(new Set(pendingItems.map(item => item.batchId)));

        // Update target batches status to PROCESSING
        await tx.bulkBatch.updateMany({
          where: { id: { in: batchIds }, status: 'PENDING' },
          data: { status: 'PROCESSING' }
        });

        // Claim items by setting status to PROCESSING
        await tx.bulkBatchItem.updateMany({
          where: { id: { in: ids } },
          data: { status: 'PROCESSING' }
        });

        return pendingItems;
      });

      if (itemsToProcess.length === 0) {
        // No more pending items to process in the entire database
        break;
      }

      console.log(`Queue worker: processing batch of ${itemsToProcess.length} items...`);

      // 2. Process the items concurrently using p-limit
      const tasks = itemsToProcess.map((item) => {
        return limit(async () => {
          let success = false;
          let errorReason: string | null = null;

          try {
            const taskReqId = require('crypto').randomUUID();
            // Call single order creation logic (which handles internal retry policies & idempotency)
            await orderService.createOrder(item.payload as any, item.courierPartner, taskReqId);
            success = true;
          } catch (err: any) {
            errorReason = err.message || 'Manifest creation failed';
          }

          // 3. Update Item and Batch stats
          await prisma.$transaction(async (tx) => {
            // Update individual item state
            await tx.bulkBatchItem.update({
              where: { id: item.id },
              data: {
                status: success ? 'SUCCESS' : 'FAILED',
                errorReason: errorReason
              }
            });

            // Update parent batch counters
            await tx.bulkBatch.update({
              where: { id: item.batchId },
              data: {
                successCount: { increment: success ? 1 : 0 },
                failedCount: { increment: success ? 0 : 1 }
              }
            });
          });
        });
      });

      // Wait for the chunk to finish processing
      await Promise.all(tasks);

      // 4. Resolve completed batches (check if parent batches are fully processed)
      const batchIdsToCheck = Array.from(new Set(itemsToProcess.map(item => item.batchId)));
      for (const batchId of batchIdsToCheck) {
        const remainingCount = await prisma.bulkBatchItem.count({
          where: {
            batchId: batchId,
            status: { in: ['PENDING', 'PROCESSING'] }
          }
        });

        if (remainingCount === 0) {
          // No remaining items, batch is completed
          await prisma.bulkBatch.update({
            where: { id: batchId },
            data: { status: 'COMPLETED' }
          });
          console.log(`Queue worker: Batch ${batchId} has COMPLETED processing.`);
        }
      }
    }
  }
}

export const queueService = new QueueService();
