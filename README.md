# Multi-Courier Integration Platform

A backend service for an e-commerce logistics platform that normalizes courier interactions through a unified REST API and pluggable courier architecture.

---

## Prerequisites

* **Node.js** (v18 or higher)
* **npm** (v9 or higher)
* **PostgreSQL** (Active instance running. If utilizing the Docker container `warmforge-db` on the system, make sure the Docker daemon is active).

---

## Setup & Installation

1. **Clone or copy** the codebase to your workspace.
2. Navigate into the directory and install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables:
   A template is provided in `.env`. The database connection string points to the running PostgreSQL container:
   ```env
   PORT=3000
   DATABASE_URL="postgresql://postgres:password@localhost:5432/multi_courier?schema=public"

   # UrbaneBolt UAT credentials
   URBANEBOLT_USERNAME="info@urbanebolt.com"
   URBANEBOLT_PASSWORD="EKIcygsLVV5RCtPZ"
   URBANEBOLT_BASE_URL="https://uat.urbanebolt.in"
   ```
4. Synchronize the PostgreSQL database schema and generate the Prisma client:
   ```bash
   npx prisma db push
   ```

---

## Running the Application

* To start the Express API in **development mode** (uses `ts-node`):
  ```bash
  npm run dev
  ```
* To build the project and run the transpiled JavaScript:
  ```bash
  npm run build
  npm start
  ```

Once running, the API will be active at `http://localhost:3000`. The background worker will automatically start polling the database for pending bulk jobs.

---

## Running Tests

Automated integration tests are written in Jest and Supertest. They test:
* Schema validations.
* Dynamic adapter loading.
* Order Manifesting, Tracking, and Cancellation flows.
* Idempotency checks.
* Asynchronous bulk order ingestion & worker execution.

To run the test suite:
```bash
npm test
```

---

## How to Add a New Courier Partner

Onboarding a new courier partner (e.g. `Delhivery`) is simple and requires **no changes** to existing controllers, routes, schemas, or domain services.

1. **Create the Adapter Class:**
   Create a new file under `src/courier/adapters/delhivery.adapter.ts`.
   Implement the `CourierAdapter` interface:
   ```typescript
   import { CourierAdapter, NormalizedOrderPayload, CourierShipmentResponse, NormalizedTrackingResponse, CourierCancelResponse } from '../courier.interface';

   export class DelhiveryAdapter implements CourierAdapter {
     public async createShipment(payload: NormalizedOrderPayload): Promise<CourierShipmentResponse> {
       // 1. Transform NormalizedOrderPayload to Delhivery payload
       // 2. Execute HTTP call to Delhivery API (handle auth, retries, timeouts)
       // 3. Return CourierShipmentResponse
     }

     public async trackShipment(awb: string): Promise<NormalizedTrackingResponse> {
       // Fetch and normalize tracking status history
     }

     public async cancelShipment(awb: string): Promise<CourierCancelResponse> {
       // Trigger cancel and return status
     }
   }
   ```
2. **Register the Adapter:**
   Open [src/courier/index.ts](file:///C:/Users/SUPREM%20HAJARE/.gemini/antigravity-ide/scratch/multi-courier-platform/src/courier/index.ts) and register the instance:
   ```typescript
   import { DelhiveryAdapter } from './adapters/delhivery.adapter';

   courierRegistry.register('delhivery', new DelhiveryAdapter());
   ```

That is it! Clients can now manifest shipments by passing `"courier_partner": "delhivery"` in the API request.

---

## Core API Endpoints

### 1. Create Order (Single)
* **URL:** `POST /api/v1/orders`
* **Request Body Example:**
  ```json
  {
    "courier_partner": "urbanebolt",
    "order_id": "ORDER_1001",
    "declared_value": 1500,
    "collectable_value": 1500,
    "item_description": "Wireless Headset",
    "item_quantity": 1,
    "pay_mode": "COD",
    "weight": 0.5,
    "shipper": {
      "name": "E-Store Seller Hub",
      "mobile": "9876543210",
      "email": "seller@estore.com",
      "address": "Warehouse Block A, Sector 4",
      "city": "Gurgaon",
      "state": "Haryana",
      "pincode": "122001",
      "country": "INDIA"
    },
    "consignee": {
      "name": "Jane Smith",
      "mobile": "8888899999",
      "email": "jane.smith@gmail.com",
      "address": "Apartment 12B, Park Avenue",
      "city": "Surat",
      "state": "Gujarat",
      "pincode": "395009",
      "country": "INDIA"
    },
    "invoice_number": "INV-10023",
    "invoice_date": "2026-06-11",
    "invoice_value": 1500
  }
  ```

### 2. Bulk Ingestion (Up to 100 Orders)
* **URL:** `POST /api/v1/orders/bulk`
* **Request Body:** A JSON array of single order objects (each item specifying its own `courier_partner`).
* **Response (Immediate - HTTP 202 Accepted):**
  ```json
  {
    "success": true,
    "data": {
      "batch_id": "01c9ab0b-4680-496a-b2f5-b3e1bf24982a",
      "status": "PENDING",
      "total_count": 3,
      "created_at": "2026-06-11T07:10:00.000Z"
    }
  }
  ```

### 3. Check Bulk Batch Status
* **URL:** `GET /api/v1/orders/bulk/:batch_id`
* **Response (HTTP 200 OK):**
  ```json
  {
    "success": true,
    "data": {
      "batch_id": "01c9ab0b-4680-496a-b2f5-b3e1bf24982a",
      "status": "COMPLETED",
      "total_count": 3,
      "success_count": 2,
      "failed_count": 1,
      "results": [
        {
          "order_id": "ORD_01",
          "courier_partner": "urbanebolt",
          "status": "SUCCESS",
          "awb": "200000006708",
          "courier_order_id": "ORD_01",
          "error_reason": null
        },
        {
          "order_id": "ORD_02",
          "courier_partner": "mock",
          "status": "FAILED",
          "awb": null,
          "error_reason": "MockCourier: Pincode serviceability check failed"
        }
      ]
    }
  }
  ```

### 4. Track Shipment
* **URL:** `GET /api/v1/orders/:order_id/track`

### 5. Cancel Shipment
* **URL:** `POST /api/v1/orders/:order_id/cancel`
