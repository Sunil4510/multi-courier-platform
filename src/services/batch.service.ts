import { prisma } from './prisma';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { queueService } from './queue.service';

export interface BulkOrderRequestItem {
  courier_partner: string;
  order_id: string;
  [key: string]: any; // holds the rest of the payload fields
}

export class BatchService {
  public async createBatch(items: BulkOrderRequestItem[]) {
    if (items.length === 0) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Bulk batch must contain at least 1 order.');
    }
    if (items.length > 100) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Bulk batch size exceeds maximum limit of 100 orders.');
    }

    // Process inside a single database transaction
    const batch = await prisma.$transaction(async (tx) => {
      // 1. Create overall BulkBatch record
      const newBatch = await tx.bulkBatch.create({
        data: {
          status: 'PENDING',
          totalCount: items.length,
          successCount: 0,
          failedCount: 0
        }
      });

      // 2. Create BulkBatchItem records for the transactional queue
      const batchItemsData = items.map((item) => {
        const { courier_partner, order_id, ...restPayload } = item;
        
        // Construct the normalized order payload structure from the flat item
        const payload = {
          orderId: order_id,
          declaredValue: restPayload.declaredValue || 0,
          collectableValue: restPayload.collectableValue || 0,
          itemDescription: restPayload.itemDescription || 'Logistics Item',
          itemQuantity: restPayload.itemQuantity || 1,
          payMode: restPayload.payMode || 'PPD',
          weight: restPayload.weight || 0.5,
          length: restPayload.length || 10,
          breadth: restPayload.breadth || 10,
          height: restPayload.height || 10,
          pieces: restPayload.pieces || 1,
          shipper: restPayload.shipper || {},
          consignee: restPayload.consignee || {},
          invoiceNumber: restPayload.invoiceNumber || '',
          invoiceDate: restPayload.invoiceDate || '',
          invoiceValue: restPayload.invoiceValue || 0
        };

        return {
          batchId: newBatch.id,
          orderId: order_id,
          courierPartner: courier_partner,
          status: 'PENDING',
          payload: payload as any
        };
      });

      await tx.bulkBatchItem.createMany({
        data: batchItemsData
      });

      return newBatch;
    });

    // Fire-and-forget background queue trigger
    // Using setImmediate ensures the current request handler finishes and returns immediately
    setImmediate(() => {
      queueService.trigger().catch((err) => {
        console.error('Failed to execute background queue:', err.message);
      });
    });

    return batch;
  }

  public async getBatchStatus(batchId: string) {
    const batch = await prisma.bulkBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          select: {
            id: true,
            orderId: true,
            courierPartner: true,
            status: true,
            errorReason: true,
            updatedAt: true
          }
        }
      }
    });

    if (!batch) {
      throw new AppError(
        404,
        ErrorCode.ORDER_NOT_FOUND,
        `Bulk batch with ID '${batchId}' not found.`
      );
    }

    // For successful items, retrieve the created AWBs from Order table
    const orderIds = batch.items.filter(item => item.status === 'SUCCESS').map(item => item.orderId);
    const manifestedOrders = await prisma.order.findMany({
      where: { orderId: { in: orderIds } },
      select: { orderId: true, awb: true, courierOrderId: true }
    });

    const orderAwbMap = new Map<string, { awb: string | null, courierOrderId: string | null }>();
    for (const o of manifestedOrders) {
      orderAwbMap.set(o.orderId, { awb: o.awb, courierOrderId: o.courierOrderId });
    }

    const itemsWithDetails = batch.items.map(item => {
      const details = orderAwbMap.get(item.orderId);
      return {
        order_id: item.orderId,
        courier_partner: item.courierPartner,
        status: item.status,
        awb: details?.awb || null,
        courier_order_id: details?.courierOrderId || null,
        error_reason: item.errorReason
      };
    });

    return {
      batch_id: batch.id,
      status: batch.status,
      total_count: batch.totalCount,
      success_count: batch.successCount,
      failed_count: batch.failedCount,
      created_at: batch.createdAt,
      updated_at: batch.updatedAt,
      results: itemsWithDetails
    };
  }
}

export const batchService = new BatchService();
