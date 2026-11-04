import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';
import { mswServer } from './msw-server.js';

// MSW 2 precisa destas APIs, ausentes no jsdom.
Object.assign(globalThis, { TextEncoder, TextDecoder });

// `onUnhandledRequest: 'error'` obriga cada teste a declarar o que a tela chama.
beforeAll(() => mswServer.listen({ onUnhandledRequest: 'error' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
