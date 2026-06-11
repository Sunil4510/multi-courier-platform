import { CourierAdapter } from './courier.interface';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

class CourierRegistry {
  private adapters = new Map<string, CourierAdapter>();

  public register(name: string, adapter: CourierAdapter): void {
    const key = name.toLowerCase();
    if (this.adapters.has(key)) {
      console.warn(`WARNING: Courier adapter '${name}' is already registered and will be overwritten.`);
    }
    this.adapters.set(key, adapter);
    console.log(`Registered courier adapter: ${name}`);
  }

  public get(name: string): CourierAdapter {
    const key = name.toLowerCase();
    const adapter = this.adapters.get(key);
    if (!adapter) {
      const supported = Array.from(this.adapters.keys());
      throw new AppError(
        400,
        ErrorCode.UNSUPPORTED_COURIER,
        `Courier partner '${name}' is not supported. Supported partners are: ${supported.join(', ')}`,
        { supportedCouriers: supported }
      );
    }
    return adapter;
  }

  public getSupportedCouriers(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const courierRegistry = new CourierRegistry();
