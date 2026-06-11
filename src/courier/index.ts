import { courierRegistry } from './courier.registry';
import { UrbaneBoltAdapter } from './adapters/urbanebolt.adapter';
import { MockCourierAdapter } from './adapters/mock.adapter';

// Initialize and register adapters
courierRegistry.register('urbanebolt', new UrbaneBoltAdapter());
courierRegistry.register('mock', new MockCourierAdapter());

export { courierRegistry };
export * from './courier.interface';
