import { describe, it, expect } from 'vitest';
import { readAsyncApiOutline, renderAsyncApiOutline } from './renderAsyncApiOutline';

const V2 = `asyncapi: 2.6.0
info:
  title: Account Service
  version: 1.0.0
  description: Manages users.
servers:
  production:
    url: broker.example.com
    protocol: mqtt
channels:
  user/signedup:
    subscribe:
      operationId: onUserSignUp
      summary: A user signed up.
      message:
        $ref: '#/components/messages/UserSignedUp'
components:
  messages:
    UserSignedUp:
      summary: Sent when a user signs up.
`;

const V3 = JSON.stringify({
  asyncapi: '3.0.0',
  info: { title: 'Orders', version: '2.0.0' },
  servers: { prod: { host: 'kafka.example.com:9092', pathname: '/v1', protocol: 'kafka' } },
  channels: { orderPlaced: { address: 'orders.placed', description: 'New orders.' } },
  operations: {
    sendOrder: { action: 'send', channel: { $ref: '#/channels/orderPlaced' }, summary: 'Place an order.' },
  },
});

describe('readAsyncApiOutline', () => {
  it('reads a 2.x document: operations come from publish/subscribe under each channel', () => {
    const outline = readAsyncApiOutline(V2);
    expect(outline).toMatchObject({ asyncapi: '2.6.0', title: 'Account Service', version: '1.0.0', description: 'Manages users.' });
    expect(outline.servers).toEqual([{ name: 'production', url: 'broker.example.com', protocol: 'mqtt' }]);
    expect(outline.operations).toEqual([
      { id: 'onUserSignUp', action: 'subscribe', channel: 'user/signedup', summary: 'A user signed up.' },
    ]);
    expect(outline.messages).toEqual([{ name: 'UserSignedUp', summary: 'Sent when a user signs up.' }]);
  });

  it('reads a 3.x JSON document: operations are top-level and reference their channel', () => {
    const outline = readAsyncApiOutline(V3);
    expect(outline.servers).toEqual([{ name: 'prod', url: 'kafka.example.com:9092/v1', protocol: 'kafka' }]);
    expect(outline.channels).toEqual([{ name: 'orderPlaced', address: 'orders.placed', description: 'New orders.' }]);
    expect(outline.operations).toEqual([
      { id: 'sendOrder', action: 'send', channel: 'orderPlaced', summary: 'Place an order.' },
    ]);
  });

  it('refuses a document with no asyncapi key, and one that is not a mapping', () => {
    expect(() => readAsyncApiOutline('openapi: 3.0.0\n')).toThrow(/asyncapi/);
    expect(() => readAsyncApiOutline('- a\n- b\n')).toThrow(/mapping/);
  });
});

describe('renderAsyncApiOutline', () => {
  it('sets spec strings as text, never as HTML', () => {
    const container = document.createElement('div');
    renderAsyncApiOutline(container, 'asyncapi: 3.0.0\ninfo:\n  title: "<img src=x onerror=alert(1)>"\n  version: "1"\n');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('omits empty sections', () => {
    const container = document.createElement('div');
    renderAsyncApiOutline(container, 'asyncapi: 3.0.0\ninfo:\n  title: Empty\n  version: "1"\n');
    expect(container.querySelectorAll('h2')).toHaveLength(0);
  });
});
