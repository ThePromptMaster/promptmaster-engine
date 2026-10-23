import { describe, expect, it } from 'vitest';
import { installStreamIterator, installWithResolvers } from './browser-shims';

describe('installStreamIterator', () => {
  it('makes a stream readable with for await where it was not', async () => {
    const proto = Object.create(null) as object;
    installStreamIterator(proto);
    expect(Symbol.asyncIterator in proto).toBe(true);

    const chunks = ['a', 'b', 'c'];
    const stream = new ReadableStream<string>({
      start(controller) {
        for (const c of chunks) controller.enqueue(c);
        controller.close();
      },
    });
    const iterate = (proto as Record<symbol, (this: ReadableStream<string>) => AsyncGenerator<string>>)[Symbol.asyncIterator];
    const seen: string[] = [];
    for await (const c of iterate.call(stream)) seen.push(c);
    expect(seen).toEqual(chunks);
    expect(stream.locked).toBe(false);
  });

  it('leaves a browser that has it alone', () => {
    const own = async function* () {};
    const proto = { [Symbol.asyncIterator]: own };
    installStreamIterator(proto);
    expect(proto[Symbol.asyncIterator]).toBe(own);
  });
});

describe('installWithResolvers', () => {
  it('adds Promise.withResolvers where missing', async () => {
    class OldPromise<T> extends Promise<T> {}
    Object.defineProperty(OldPromise, 'withResolvers', { value: undefined, configurable: true, writable: true });
    installWithResolvers(OldPromise as unknown as PromiseConstructor);
    const { promise, resolve } = (OldPromise as unknown as PromiseConstructor).withResolvers<number>();
    resolve(7);
    await expect(promise).resolves.toBe(7);
  });
});
