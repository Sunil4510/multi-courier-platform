import axios, { AxiosError } from 'axios';
import { 
  CourierAdapter, 
  NormalizedOrderPayload, 
  CourierShipmentResponse, 
  NormalizedTrackingResponse, 
  CourierCancelResponse,
  TrackingActivity
} from '../courier.interface';
import { env } from '../../config/env';
import { AppError } from '../../errors/app-error';
import { ErrorCode } from '../../errors/error-codes';

export class UrbaneBoltAdapter implements CourierAdapter {
  private cachedToken: string | null = null;
  private tokenExpiry: Date | null = null;

  private async getToken(): Promise<string> {
    // If token exists and is not expired (leave a 5-minute buffer)
    if (this.cachedToken && this.tokenExpiry && this.tokenExpiry.getTime() > Date.now() + 300000) {
      return this.cachedToken;
    }

    try {
      const url = `${env.URBANEBOLT_BASE_URL}/api/v1/auth/getToken/`;
      const response = await axios.post(
        url,
        {
          username: env.URBANEBOLT_USERNAME,
          password: env.URBANEBOLT_PASSWORD
        },
        { timeout: env.HTTP_TIMEOUT_MS }
      );

      if (response.data && response.data.access_token) {
        this.cachedToken = response.data.access_token;
        // Parse expiry or default to 24 hours
        if (response.data.expires) {
          this.tokenExpiry = new Date(response.data.expires);
        } else {
          const expiresIn = response.data.expires_in || 86400;
          this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);
        }
        return this.cachedToken!;
      }

      throw new AppError(
        500,
        ErrorCode.COURIER_AUTH_ERROR,
        'UrbaneBolt auth response did not contain access_token.'
      );
    } catch (error: any) {
      console.error('UrbaneBolt Authentication failed:', error.message);
      throw new AppError(
        500,
        ErrorCode.COURIER_AUTH_ERROR,
        `Failed to authenticate with UrbaneBolt: ${error.message}`
      );
    }
  }

  private async executeWithAuth<T>(requestFn: (token: string) => Promise<T>): Promise<T> {
    let token = await this.getToken();
    try {
      return await requestFn(token);
    } catch (error: any) {
      const isAuthError = error.response && (error.response.status === 401 || error.response.status === 403);
      if (isAuthError) {
        console.log('UrbaneBolt returned unauthorized. Fetching new token and retrying...');
        this.cachedToken = null;
        this.tokenExpiry = null;
        token = await this.getToken();
        return await requestFn(token);
      }
      throw error;
    }
  }

  public async createShipment(payload: NormalizedOrderPayload): Promise<CourierShipmentResponse> {
    return this.executeWithAuth(async (token) => {
      // Map normalized schema to UrbaneBolt's expected payload (Manifest API takes an array)
      const urbaneBoltPayload = [{
        customerCode: 'UEBCUS0008', // Default UAT customer code as per reference documentation
        orderNumber: payload.orderId,
        declaredValue: payload.declaredValue,
        itemDescription: payload.itemDescription,
        collectableValue: payload.collectableValue,
        height: payload.height,
        length: payload.length,
        pieces: payload.pieces,
        weight: payload.weight,
        breadth: payload.breadth,
        serviceType: 'SDD', // Default UAT service type
        payMode: payload.payMode,
        
        // Return / Pickup Details
        rtnCity: payload.shipper.city,
        rtnName: payload.shipper.name,
        rtnEmail: payload.shipper.email,
        rtnState: payload.shipper.state,
        rtnMobile: parseInt(payload.shipper.mobile, 10) || 9999999999,
        rtnAddress: payload.shipper.address,
        rtnAddressType: 'Seller',
        rtnCountry: payload.shipper.country || 'INDIA',
        rtnPincode: parseInt(payload.shipper.pincode, 10),

        // Shipper Details
        shprCity: payload.shipper.city,
        shprName: payload.shipper.name,
        shprEmail: payload.shipper.email,
        shprState: payload.shipper.state,
        shprMobile: parseInt(payload.shipper.mobile, 10) || 9999999999,
        shprAddress: payload.shipper.address,
        shprAddressType: 'Seller',
        shprCountry: payload.shipper.country || 'INDIA',
        shprPincode: parseInt(payload.shipper.pincode, 10),

        // Consignee Details
        consCity: payload.consignee.city,
        consName: payload.consignee.name,
        consEmail: payload.consignee.email,
        consState: payload.consignee.state,
        consMobile: parseInt(payload.consignee.mobile, 10) || 9999999999,
        consAddress: payload.consignee.address,
        consAddressType: 'Home',
        consCountry: payload.consignee.country || 'INDIA',
        consPincode: parseInt(payload.consignee.pincode, 10),

        invoiceNumber: payload.invoiceNumber,
        invoiceDate: payload.invoiceDate,
        invoiceValue: payload.invoiceValue,
        itemQuantity: payload.itemQuantity
      }];

      try {
        const url = `${env.URBANEBOLT_BASE_URL}/api/v1/services/manifest/`;
        const response = await axios.post(url, urbaneBoltPayload, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: env.HTTP_TIMEOUT_MS
        });

        const data = response.data;
        
        // Handle UrbaneBolt response validation
        if (data.status === 'Success' && data.successResponse && data.successResponse.length > 0) {
          const successItem = data.successResponse[0];
          return {
            courierOrderId: successItem.orderNumber || payload.orderId,
            awb: String(successItem.awbNumber),
            status: 'CREATED',
            rawResponse: data
          };
        }

        // If there is an error in errorResponse array
        if (data.errorResponse && data.errorResponse.length > 0) {
          const err = data.errorResponse[0];
          throw new AppError(
            400,
            ErrorCode.COURIER_API_ERROR,
            err.errorDescription || 'Courier failed to process the manifest request',
            err
          );
        }

        throw new AppError(
          400,
          ErrorCode.COURIER_API_ERROR,
          data.message || 'Manifest creation returned unsuccessful status',
          data
        );
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        this.handleAxiosError(err, payload.orderId);
      }
    });
  }

  public async trackShipment(awb: string): Promise<NormalizedTrackingResponse> {
    return this.executeWithAuth(async (token) => {
      try {
        const url = `${env.URBANEBOLT_BASE_URL}/api/v1/services/tracking-pub/?awb=${awb}`;
        const response = await axios.get(url, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: env.HTTP_TIMEOUT_MS
        });

        const resData = response.data;
        if (resData.status !== 'Success' || !resData.data) {
          throw new AppError(
            400,
            ErrorCode.COURIER_API_ERROR,
            resData.message || 'Tracking request failed',
            resData
          );
        }

        const data = resData.data;
        const rawStatusDesc = data.currentStatusCodeDescription || '';
        const normalizedStatus = this.mapStatus(rawStatusDesc);

        const scans: any[] = data.scans || [];
        const travelHistory: TrackingActivity[] = scans.map((scan) => {
          // Parse date like: "11 Jun 2026, 12:32"
          let timestamp = new Date();
          if (scan.statusDateTime) {
            timestamp = new Date(scan.statusDateTime);
            if (isNaN(timestamp.getTime())) {
              timestamp = new Date();
            }
          }

          return {
            status: this.mapStatus(scan.statusCodeDescription || ''),
            activity: scan.statusCodeDescription || scan.statusCode || 'Scan Activity',
            location: scan.currentLocation || '',
            timestamp,
            raw: scan
          };
        });

        return {
          awb: String(data.awbNumber),
          status: normalizedStatus,
          travelHistory,
          rawResponse: resData
        };
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        this.handleAxiosError(err, awb);
      }
    });
  }

  public async cancelShipment(awb: string): Promise<CourierCancelResponse> {
    return this.executeWithAuth(async (token) => {
      try {
        const url = `${env.URBANEBOLT_BASE_URL}/api/v1/services/cancel/`;
        const response = await axios.post(
          url,
          { awbs: awb },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            timeout: env.HTTP_TIMEOUT_MS
          }
        );

        const data = response.data;
        if (data.status === 'Success' && data.successResponse && data.successResponse.length > 0) {
          return {
            success: true,
            message: data.successResponse[0].message || 'Cancelled successfully',
            rawResponse: data
          };
        }

        if (data.failureResponse && data.failureResponse.length > 0) {
          throw new AppError(
            400,
            ErrorCode.CANCEL_NOT_ALLOWED,
            data.failureResponse[0].message || 'Courier rejected cancellation',
            data.failureResponse[0]
          );
        }

        throw new AppError(
          400,
          ErrorCode.COURIER_API_ERROR,
          data.message || 'Cancellation request was not successful',
          data
        );
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        this.handleAxiosError(err, awb);
      }
    });
  }

  private mapStatus(description: string): string {
    const desc = description.toLowerCase();
    if (desc.includes('delivered')) return 'DELIVERED';
    if (desc.includes('cancel')) return 'CANCELLED';
    if (desc.includes('failed') || desc.includes('rto') || desc.includes('undelivered')) return 'FAILED';
    if (desc.includes('picked') || desc.includes('pickup') || desc.includes('received')) return 'PICKED_UP';
    if (desc.includes('manifest') || desc.includes('created')) return 'CREATED';
    return 'IN_TRANSIT'; // Default status for progress
  }

  private handleAxiosError(error: any, identifier: string): never {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      throw new AppError(
        504,
        ErrorCode.COURIER_TIMEOUT,
        `Connection timeout with UrbaneBolt API for order/AWB: ${identifier}`
      );
    }

    const axiosError = error as AxiosError;
    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data as any;
      const message = (data && data.detail) || (data && data.message) || axiosError.message;
      
      throw new AppError(
        status >= 500 ? 502 : 400,
        ErrorCode.COURIER_API_ERROR,
        `UrbaneBolt error: ${message}`,
        data
      );
    }

    throw new AppError(
      500,
      ErrorCode.INTERNAL_SERVER_ERROR,
      `Network error communicating with UrbaneBolt: ${error.message}`
    );
  }
}
