import { EventEmitter } from 'node:events';

// Bus interno para refrescar el panel en tiempo real (Server-Sent Events).
export const bus = new EventEmitter();
bus.setMaxListeners(100);
