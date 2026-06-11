export interface AddressDetails {
  name: string;
  mobile: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface NormalizedOrderPayload {
  orderId: string;
  declaredValue: number;
  collectableValue: number;
  itemDescription: string;
  itemQuantity: number;
  payMode: 'COD' | 'PPD';
  weight: number;
  length: number;
  breadth: number;
  height: number;
  pieces: number;
  shipper: AddressDetails;
  consignee: AddressDetails;
  invoiceNumber: string;
  invoiceDate: string; // YYYY-MM-DD
  invoiceValue: number;
}

export interface CourierShipmentResponse {
  courierOrderId: string;
  awb: string;
  status: string; // e.g. CREATED, PICKED_UP, etc.
  rawResponse: any;
}

export interface TrackingActivity {
  status: string; // Normalized status
  activity: string; // Human readable description
  location: string;
  timestamp: Date;
  raw: any;
}

export interface NormalizedTrackingResponse {
  awb: string;
  status: string; // Current normalized status
  travelHistory: TrackingActivity[];
  rawResponse: any;
}

export interface CourierCancelResponse {
  success: boolean;
  message: string;
  rawResponse: any;
}

export interface CourierAdapter {
  createShipment(payload: NormalizedOrderPayload): Promise<CourierShipmentResponse>;
  trackShipment(awb: string): Promise<NormalizedTrackingResponse>;
  cancelShipment(awb: string): Promise<CourierCancelResponse>;
}
