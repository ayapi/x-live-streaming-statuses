export type WancommeError =
  | { kind: "connection_refused"; message: string }
  | { kind: "api_error"; status: number; message: string }
  | { kind: "timeout" };

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

interface SendParams {
  host: string;
  port: number;
  serviceId: string;
  viewerCount: number;
}

export interface WancommeClient {
  sendViewerCount(params: SendParams): Promise<Result<void, WancommeError>>;
}

export function createWancommeClient(
  fetchFn: typeof fetch = fetch,
): WancommeClient {
  return {
    async sendViewerCount(
      params: SendParams,
    ): Promise<Result<void, WancommeError>> {
      const url = `http://${params.host}:${params.port}/api/services/${params.serviceId}`;

      try {
        const response = await fetchFn(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meta: { viewer: params.viewerCount } }),
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
