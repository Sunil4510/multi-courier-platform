import { Request, Response, NextFunction } from 'express';
import { orderService } from '../services/order.service';
import { NormalizedOrderPayload } from '../courier/courier.interface';

export class OrderController {
  private mapToNormalizedPayload(body: any): NormalizedOrderPayload {
    return {
      orderId: body.order_id,
      declaredValue: Number(body.declared_value) || 0,
      collectableValue: Number(body.collectable_value) || 0,
      itemDescription: body.item_description,
      itemQuantity: Number(body.item_quantity) || 1,
      payMode: body.pay_mode as 'COD' | 'PPD',
      weight: Number(body.weight) || 0.5,
      length: Number(body.length) || 10,
      breadth: Number(body.breadth) || 10,
      height: Number(body.height) || 10,
      pieces: Number(body.pieces) || 1,
      shipper: {
        name: body.shipper.name,
        mobile: String(body.shipper.mobile),
        email: body.shipper.email,
        address: body.shipper.address,
        city: body.shipper.city,
        state: body.shipper.state,
        pincode: String(body.shipper.pincode),
        country: body.shipper.country
      },
      consignee: {
        name: body.consignee.name,
        mobile: String(body.consignee.mobile),
        email: body.consignee.email,
        address: body.consignee.address,
        city: body.consignee.city,
        state: body.consignee.state,
        pincode: String(body.consignee.pincode),
        country: body.consignee.country
      },
      invoiceNumber: body.invoice_number,
      invoiceDate: body.invoice_date,
      invoiceValue: Number(body.invoice_value) || 0
    };
  }

  public createOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const normalizedPayload = this.mapToNormalizedPayload(req.body);
      const courierPartner = req.body.courier_partner;

      const order = await orderService.createOrder(normalizedPayload, courierPartner);
      
      res.status(201).json({
        success: true,
        data: {
          id: order.id,
          order_id: order.orderId,
          courier_partner: order.courierPartner,
          courier_order_id: order.courierOrderId,
          awb: order.awb,
          status: order.status,
          created_at: order.createdAt,
          updated_at: order.updatedAt
        }
      });
    } catch (error) {
      next(error);
    }
  };

  public trackOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order_id } = req.params;
      const trackingData = await orderService.trackOrder(order_id);
      
      res.status(200).json({
        success: true,
        data: trackingData
      });
    } catch (error) {
      next(error);
    }
  };

  public cancelOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { order_id } = req.params;
      const cancelResult = await orderService.cancelOrder(order_id);
      
      res.status(200).json({
        success: true,
        message: cancelResult.message
      });
    } catch (error) {
      next(error);
    }
  };
}

export const orderController = new OrderController();
