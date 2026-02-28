export type ViewerCountClientError =
  | { kind: "connection_refused"; message: string }
  | { kind: "api_error"; status: number; message: string }
  | { kind: "timeout" };

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

interface SendParams {
  host: string;
  port: number;
  viewerCount: number;
}

export interface ViewerCountClient {
  sendViewerCount(params: SendParams): Promise<Result<void, ViewerCountClientError>>;
}

export function createViewerCountClient(
  fetchFn: typeof fetch = fetch,
): ViewerCountClient {
  return {
    async sendViewerCount(
      params: SendParams,
    ): Promise<Result<void, ViewerCountClientError>> {
      const url = `http://${params.host}:${params.port}/api/viewer-count`;

      try {
        const response = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewerCount: params.viewerCount }),
        });

        if (!response.ok) {
          return {
            ok: false,
            error: {
              kind: "api_error",
              status: response.status,
              message: response.statusText,
            },
          };
        }

        return { ok: true, value: undefined };
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return { ok: false, error: { kind: "timeout" } };
        }
        const message = e instanceof Error ? e.message : String(e);
        return {
          ok: false,
          error: { kind: "connection_refused", message },
        };
      }
    },
  };
}
