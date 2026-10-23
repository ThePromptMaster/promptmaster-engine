/**
 * What the PDF reader needs that Safari does not have yet.
 *
 * pdfjs reads a page's text with `for await (const chunk of readableStream)`.
 * Safari, iPhone included, has no `ReadableStream.prototype[Symbol.asyncIterator]`,
 * so every PDF failed there with "undefined is not a function (near '...t of
 * e...')" (client, 22 Oct) while the same file read fine on a computer.
 * `Promise.withResolvers` is the other one: Safari before 17.4 lacks it.
 *
 * Each is installed only where missing, before pdfjs is loaded.
 */

export function installStreamIterator(proto: object | undefined = globalThis.ReadableStream?.prototype): void {
  if (!proto || Symbol.asyncIterator in proto) return;
  Object.defineProperty(proto, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* iterate(this: ReadableStream) {
      const reader = this.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function installWithResolvers(P: PromiseConstructor = Promise): void {
  if (typeof (P as { withResolvers?: unknown }).withResolvers === 'function') return;
  Object.defineProperty(P, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new P<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    },
  });
}

export function installPdfShims(): void {
  installStreamIterator();
  installWithResolvers();
}
