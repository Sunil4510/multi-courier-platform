import { prisma } from './prisma';
import { courierRegistry } from '../courier';
import { NormalizedOrderPayload } from '../courier/courier.interface';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import { env } from '../config/env';

export class OrderService {
  /**
   * Helper utility for execution with retry and exponential backoff.
   * Only retries on 5xx errors, timeouts, or network failures.
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: any;
    let delay = env.RETRY_DELAY_MS;

    for (let i = 0; i < env.MAX_RETRIES; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Do not retry client validation errors (HTTP 4xx) except timeouts
        if (
          error instanceof AppError && 
          error.statusCode < 500 && 
          error.code !== ErrorCode.COURIER_TIMEOUT
        ) {
          throw error;
        }

        console.warn(`Retry attempt ${i + 1}/${env.MAX_RETRIES} failed: ${error.message}. Retrying in ${delay}ms...`);
        if (i < env.MAX_RETRIES - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
        }
      }
    }
    throw lastError;
  }

  public async createOrder(payload: NormalizedOrderPayload, courierPartner: string, requestId?: string) {
    const partner = courierPartner.toLowerCase();
    
    // 1. Idempotency Check
    const existingOrder = await prisma.order.findUnique({
      where: { orderId: payload.orderId },
    });

    if (existingOrder) {
      // If the order exists and is NOT in FAILED status, return the cached result
      if (existingOrder.status !== 'FAILED') {
        console.log(`Idempotency trigger: Order ${payload.orderId} already exists. Returning cached order.`);
        return existingOrder;
      }
      // If it exists but failed previously, we will attempt to recreate it by updating the record
      console.log(`Re-attempting previously failed order ${payload.orderId}.`);
    }

    const adapter = courierRegistry.get(partner);
    let orderResult: any = null;
    let errorDetail: any = null;
    let finalStatus = 'CREATED';

    try {
      // Execute the courier API call with retry policy
      orderResult = await this.retryWithBackoff(() => adapter.createShipment(payload));
    } catch (err: any) {
      console.error(
        `[Failure] Order creation failed. ` +
        `OrderID: ${payload.orderId}, ` +
        `Courier: ${partner}, ` +
        `RequestID: ${requestId || 'N/A'}, ` +
        `ErrorType: ${err instanceof AppError ? err.code : 'UNKNOWN_ERROR'}, ` +
        `Stack: ${err.stack || 'No stack trace'}`
      );
      errorDetail = err instanceof AppError ? { 
        message: err.message, 
        code: err.code, 
        details: err.details 
      } : { message: err.message };
      finalStatus = 'FAILED';
    }

    // 2. Persist the shipment in Database
    if (existingOrder) {
      // Update existing failed order
      const updatedOrder = await prisma.order.update({
        where: { id: existingOrder.id },
        data: {
          courierPartner: partner,
          courierOrderId: orderResult?.courierOrderId || null,
          awb: orderResult?.awb || null,
          status: finalStatus,
          requestPayload: payload as any,
          responsePayload: (orderResult?.rawResponse || errorDetail) as any,
        }
      });

      if (finalStatus === 'CREATED' && orderResult) {
        await prisma.trackingHistory.create({
          data: {
            orderId: updatedOrder.id,
            status: 'CREATED',
            rawPayload: orderResult.rawResponse as any,
          }
        });
      }

      if (finalStatus === 'FAILED') {
        throw new AppError(
          400,
          ErrorCode.COURIER_API_ERROR,
          `Courier failed to manifest order: ${errorDetail?.message || 'Unknown error'}`
        );
      }

      return updatedOrder;
    } else {
      // Insert new order
      const createdOrder = await prisma.order.create({
        data: {
          orderId: payload.orderId,
          courierPartner: partner,
          courierOrderId: orderResult?.courierOrderId || null,
          awb: orderResult?.awb || null,
          status: finalStatus,
          requestPayload: payload as any,
          responsePayload: (orderResult?.rawResponse || errorDetail) as any,
        }
      });

      if (finalStatus === 'CREATED' && orderResult) {
        await prisma.trackingHistory.create({
          data: {
            orderId: createdOrder.id,
            status: 'CREATED',
            rawPayload: orderResult.rawResponse as any,
          }
        });
      }

      if (finalStatus === 'FAILED') {
        throw new AppError(
          400,
          ErrorCode.COURIER_API_ERROR,
          `Courier failed to manifest order: ${errorDetail?.message || 'Unknown error'}`
        );
      }

      return createdOrder;
    }
  }

  public async trackOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { orderId },
      include: { trackingHistory: { orderBy: { timestamp: 'desc' } } }
    });

    if (!order) {
      throw new AppError(
        404,
        ErrorCode.ORDER_NOT_FOUND,
        `Order with internal ID '${orderId}' not found.`
      );
    }

    // If order was not manifested successfully or has no AWB, return current db status
    if (order.status === 'FAILED' || !order.awb) {
      return {
        orderId: order.orderId,
        courierPartner: order.courierPartner,
        status: order.status,
        awb: order.awb,
        trackingHistory: order.trackingHistory
      };
    }

    try {
      const adapter = courierRegistry.get(order.courierPartner);
      const trackingInfo = await adapter.trackShipment(order.awb);

      // Append new scan events to local TrackingHistory
      const localScans = order.trackingHistory;
      
      // Determine if there are new status updates.
      // We will add the scan events that don't already exist in our DB
      for (const scan of trackingInfo.travelHistory) {
        const alreadyExists = localScans.some(
          ls => ls.status === scan.status && 
                new Date(ls.timestamp).getTime() === new Date(scan.timestamp).getTime()
        );

        if (!alreadyExists) {
          await prisma.trackingHistory.create({
            data: {
              orderId: order.id,
              status: scan.status,
              rawPayload: scan.raw as any,
              timestamp: scan.timestamp
            }
          });
        }
      }

      // Update the Order status if it changed
      let updatedOrder = order;
      if (trackingInfo.status !== order.status) {
        updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: { status: trackingInfo.status },
          include: { trackingHistory: { orderBy: { timestamp: 'desc' } } }
        });
      } else {
        // Refresh tracking history from DB
        updatedOrder.trackingHistory = await prisma.trackingHistory.findMany({
          where: { orderId: order.id },
          orderBy: { timestamp: 'desc' }
        });
      }

      return {
        orderId: updatedOrder.orderId,
        courierPartner: updatedOrder.courierPartner,
        status: updatedOrder.status,
        awb: updatedOrder.awb,
        trackingHistory: updatedOrder.trackingHistory
      };
    } catch (err: any) {
      console.error(`Failed to fetch online tracking for AWB ${order.awb}:`, err.message);
      // Fallback: return cached DB status if external tracking fails
      return {
        orderId: order.orderId,
        courierPartner: order.courierPartner,
        status: order.status,
        awb: order.awb,
        trackingHistory: order.trackingHistory,
        _warning: `Online tracking failed: ${err.message}. Showing cached database logs.`
      };
    }
  }

  public async cancelOrder(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { orderId }
    });

    if (!order) {
      throw new AppError(
        404,
        ErrorCode.ORDER_NOT_FOUND,
        `Order with internal ID '${orderId}' not found.`
      );
    }

    if (order.status === 'CANCELLED') {
      return { success: true, message: 'Order is already cancelled' };
    }

    if (order.status === 'DELIVERED') {
      throw new AppError(
        400,
        ErrorCode.CANCEL_NOT_ALLOWED,
        'Cannot cancel an order that has already been delivered.'
      );
    }

    if (!order.awb) {
      // If there is no AWB, we can simply cancel it locally
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' }
      });
      return { success: true, message: 'Locally cancelled order (No shipment manifested)' };
    }

    const adapter = courierRegistry.get(order.courierPartner);
    const cancelResult = await adapter.cancelShipment(order.awb);

    if (cancelResult.success) {
      // Update database status
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' }
      });

      await prisma.trackingHistory.create({
        data: {
          orderId: order.id,
          status: 'CANCELLED',
          rawPayload: cancelResult.rawResponse as any
        }
      });
    }

    return {
      success: cancelResult.success,
      message: cancelResult.message
    };
  }
}

export const orderService = new OrderService();
