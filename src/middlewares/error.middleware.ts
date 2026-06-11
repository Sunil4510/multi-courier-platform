import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // If it's a known application error (AppError)
  if (err instanceof AppError) {
    console.error(`[AppError] ${err.code} - ${err.message}`, err.details ? `Details: ${JSON.stringify(err.details)}` : '');
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || null
      }
    });
  }

  // Fallback for unhandled/general server errors
  console.error('[UnhandledError] Uncaught exception on route:', req.originalUrl, '\nStack trace:', err.stack);
  
  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: 'An internal server error occurred.',
      details: process.env.NODE_ENV === 'development' ? err.stack : null
    }
  });
}
