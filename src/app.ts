import express from 'express';
import { env } from './config/env';
import { orderRouter } from './routes/order.routes';
import { errorHandler } from './middlewares/error.middleware';
import { queueService } from './services/queue.service';
import './courier'; // Triggers static initialization/registration of courier adapters

const app = express();

app.use(express.json());

// Main Router Mount
app.use('/api/v1/orders', orderRouter);

// Fallback Route for Undefined Enpoints
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Requested route '${req.method} ${req.originalUrl}' does not exist.`
    }
  });
});

// Mount Global Error Handler
app.use(errorHandler);

// Start HTTP Server and Background Queue Poller
const server = app.listen(env.PORT, () => {
  console.log(`==========================================`);
  console.log(` Multi-Courier Integration Platform       `);
  console.log(` Running on port: ${env.PORT}             `);
  console.log(` Database: PostgreSQL                     `);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`==========================================`);
  
  // Start the database background queue worker poller
  queueService.startPolling();
});

export { app, server };
export default app;
