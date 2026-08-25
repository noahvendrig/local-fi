import { loadAnalysisJobSnapshot, subscribeToAnalysisJob, type AnalysisJobSnapshot } from "@/lib/analysis/events";

const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

/** SSE stream of analysis job/track progress — mirrors app/api/v1/import/jobs/[id]/events/route.ts. */
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

      const initial = loadAnalysisJobSnapshot(jobId);
      if (!initial) {
        send("error", { message: "Analysis job not found." });
        close();
        return;
      }

      send("update", initial);
      if (TERMINAL_STATUSES.has(initial.job.status)) {
        close();
        return;
      }

      unsubscribe = subscribeToAnalysisJob(jobId, (snapshot: AnalysisJobSnapshot) => {
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
