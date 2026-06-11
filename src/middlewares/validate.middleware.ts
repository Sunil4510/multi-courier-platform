import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

interface ValidationErrorField {
  field: string;
  message: string;
}

export function validateSingleOrder(req: Request, res: Response, next: NextFunction) {
  const errors: ValidationErrorField[] = [];
  const body = req.body;

  if (!body) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Request body is missing.');
  }

  const requiredFields = [
    'order_id',
    'courier_partner',
    'declared_value',
    'item_description',
    'pay_mode',
    'weight',
    'shipper',
    'consignee',
    'invoice_number',
    'invoice_date',
    'invoice_value',
  ];

  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      errors.push({ field, message: `${field} is a required field.` });
    }
  }

  // Pay mode validation
  if (body.pay_mode && !['COD', 'PPD'].includes(body.pay_mode)) {
    errors.push({ field: 'pay_mode', message: 'pay_mode must be either COD or PPD.' });
  }

  // Address validations
  const validateAddress = (addr: any, parentField: string) => {
    if (!addr || typeof addr !== 'object') return;
    const requiredAddrFields = ['name', 'mobile', 'address', 'city', 'state', 'pincode', 'country'];
    for (const f of requiredAddrFields) {
      if (!addr[f]) {
        errors.push({ field: `${parentField}.${f}`, message: `${parentField}.${f} is required.` });
      }
    }
  };

  if (body.shipper) validateAddress(body.shipper, 'shipper');
  if (body.consignee) validateAddress(body.consignee, 'consignee');

  if (errors.length > 0) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Validation failed for order fields.', errors);
  }

  next();
}

export function validateBulkOrders(req: Request, res: Response, next: NextFunction) {
  const body = req.body;
  if (!body || !Array.isArray(body)) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Bulk request body must be a JSON array.');
  }

  if (body.length === 0) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Bulk batch must contain at least 1 order.');
  }

  if (body.length > 100) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Bulk batch size exceeds maximum limit of 100 orders.');
  }

  const errors: ValidationErrorField[] = [];
  body.forEach((item, index) => {
    if (!item.order_id) {
      errors.push({ field: `[${index}].order_id`, message: 'order_id is required.' });
    }
    if (!item.courier_partner) {
      errors.push({ field: `[${index}].courier_partner`, message: 'courier_partner is required.' });
    }
    if (item.pay_mode && !['COD', 'PPD'].includes(item.pay_mode)) {
      errors.push({ field: `[${index}].pay_mode`, message: 'pay_mode must be either COD or PPD.' });
    }
  });

  if (errors.length > 0) {
    throw new AppError(400, ErrorCode.VALIDATION_ERROR, 'Validation failed for one or more bulk order items.', errors);
  }

  next();
}
