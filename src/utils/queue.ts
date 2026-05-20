export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(value: T) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  close() {
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined as any, done: true });
    }
  }

  get length(): number {
    return this.queue.length;
  }

  clear() {
    this.queue = [];
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const nextVal = await new Promise<IteratorResult<T>>((resolve) => {
          this.resolvers.push(resolve);
        });
        if (nextVal.done) {
          return;
        }
        yield nextVal.value;
      }
    }
  }
}
