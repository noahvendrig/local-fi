import { loadJobSnapshot, subscribeToJob, type JobSnapshot } from "@/lib/import/events";

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

/**
 * SSE stream of job/file progress (ARCHITECTURE.md §7). Primary transport for
 * the desktop Ingest tray; `GET /import/jobs/:id` remains a fully-functional
 * polling fallback for clients that handle long-lived connections poorly.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = Number(id);
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const close = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const initial = loadJobSnapshot(jobId);
      if (!initial) {
        send("error", { message: "Import job not found." });
        close();
        return;
      }

      send("update", initial);
      if (TERMINAL_STATUSES.has(initial.job.status)) {
        close();
        return;
      }

      unsubscribe = subscribeToJob(jobId, (snapshot: JobSnapshot) => {
        send("update", snapshot);
        if (TERMINAL_STATUSES.has(snapshot.job.status)) close();
      });

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
