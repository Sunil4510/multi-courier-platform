import { Request, Response, NextFunction } from 'express';
import { batchService } from '../services/batch.service';

export class BatchController {
  public createBatch = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = req.body;
      const batch = await batchService.createBatch(items);
      
      res.status(202).json({
        success: true,
        data: {
          batch_id: batch.id,
          status: batch.status,
          total_count: batch.totalCount,
          created_at: batch.createdAt
        }
      });
    } catch (error) {
      next(error);
    }
  };

  public getBatchStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { batch_id } = req.params;
      const batchDetails = await batchService.getBatchStatus(batch_id);
      
      res.status(200).json({
        success: true,
        data: batchDetails
      });
    } catch (error) {
      next(error);
    }
  };
}

export const batchController = new BatchController();
