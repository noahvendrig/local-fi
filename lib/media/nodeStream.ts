import type { Readable } from "node:stream";

/**
 * Bridges a Node `Readable` (from `fs.createReadStream`) to a Web `ReadableStream` with our own
 * close/error bookkeeping, rather than `Readable.toWeb()`. That built-in adapter races a client
 * mid-stream disconnect (a track skip/seek cancelling the fetch) against the source stream's own
 * "end" event — both paths can call `controller.close()`, and the second call throws
 * `TypeError: Invalid state: Controller is already closed` as an *uncaught* exception (it fires
 * from inside the stream internals, not the request's promise chain, so Next's own error
 * handling never sees it). Tracking `closed` ourselves makes every close/error path a no-op once
 * either has already fired. Shared by every route that streams a local audio file back
 * (tracks/:id/stream, mixtapes/:id/stream) — both need the exact same fix.
 */
export function nodeStreamToWebStream(nodeStream: Readable): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => {
        if (!closed) controller.enqueue(chunk);
      });
      nodeStream.on("end", () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
      nodeStream.on("error", (err) => {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
        nodeStream.destroy();
      });
    },
    cancel() {
      closed = true;
      nodeStream.destroy();
    },
  });
}
