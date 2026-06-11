import { 
  CourierAdapter, 
  NormalizedOrderPayload, 
  CourierShipmentResponse, 
  NormalizedTrackingResponse, 
  CourierCancelResponse 
} from '../courier.interface';
import { AppError } from '../../errors/app-error';
import { ErrorCode } from '../../errors/error-codes';

export class MockCourierAdapter implements CourierAdapter {
  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public async createShipment(payload: NormalizedOrderPayload): Promise<CourierShipmentResponse> {
    await this.delay(50); // Simulate network latency

    // Check if the order ID contains 'fail' to test error handling pathways
    if (payload.orderId.toLowerCase().includes('fail')) {
      throw new AppError(
        400,
        ErrorCode.COURIER_API_ERROR,
        'MockCourier: Pincode serviceability check failed',
        { reason: 'Pincode not serviceable', code: 40012 }
      );
    }

    // Generate a mock AWB
    const randomAwb = 'MC' + Math.floor(1000000000 + Math.random() * 9000000000);

    return {
      courierOrderId: 'MOCK_ORD_' + payload.orderId,
      awb: randomAwb,
      status: 'CREATED',
      rawResponse: {
        success: true,
        message: 'Order manifested in MockCourier system',
        mockAwb: randomAwb,
        estimatedDeliveryDays: 3
      }
    };
  }

  public async trackShipment(awb: string): Promise<NormalizedTrackingResponse> {
    await this.delay(30);

    if (awb.startsWith('MC_FAIL')) {
      throw new AppError(
        404,
        ErrorCode.COURIER_API_ERROR,
        'MockCourier: AWB number not found in mock database',
        { awb }
      );
    }

    // Generate simulated tracking history
    const now = new Date();
    const manifestTime = new Date(now.getTime() - 2 * 3600000 * 24); // 2 days ago
    const pickupTime = new Date(now.getTime() - 3600000 * 24); // 1 day ago
    const transitTime = new Date(now.getTime() - 12 * 3600000); // 12 hours ago

    return {
      awb,
      status: 'IN_TRANSIT',
      travelHistory: [
        {
          status: 'CREATED',
          activity: 'Shipment Created & Manifested',
          location: 'Mock Origin Warehouse',
          timestamp: manifestTime,
          raw: { event: 'manifest' }
        },
        {
          status: 'PICKED_UP',
          activity: 'Package Handed Over to MockCourier Rider',
          location: 'Mock Origin Warehouse',
          timestamp: pickupTime,
          raw: { event: 'pickup' }
        },
        {
          status: 'IN_TRANSIT',
          activity: 'In Transit: Departed Hub',
          location: 'Mock Mid-way Sort Facility',
          timestamp: transitTime,
          raw: { event: 'transit' }
        }
      ],
      rawResponse: {
        awb,
        currentStage: 'transit',
        courierComments: 'On schedule'
      }
    };
  }

  public async cancelShipment(awb: string): Promise<CourierCancelResponse> {
    await this.delay(40);

    // Cancel fails if AWB contains "nocancel"
    if (awb.includes('NOCANCEL')) {
      throw new AppError(
        400,
        ErrorCode.CANCEL_NOT_ALLOWED,
        'MockCourier: Shipment already loaded on vehicle and cannot be cancelled.',
        { awb }
      );
    }

    return {
      success: true,
      message: 'Cancellation confirmed by MockCourier',
      rawResponse: {
        awb,
        status: 'cancelled_at_origin'
      }
    };
  }
}
