import type { Result } from "./result.js";
import type { OneCommeService, ServiceResolveError } from "./types.js";
import { ok, err } from "./result.js";

export interface ServiceResolver {
  resolve(serviceName: string): Promise<Result<string, ServiceResolveError>>;
}

type FetchFn = typeof globalThis.fetch;

/**
 * わんコメAPIからサービス名でIDを解決するServiceResolverを生成する。
 * fetchFnパラメータでDI可能（テスト時にモック注入）。
 */
export function createServiceResolver(
  config: { host: string; port: number },
  fetchFn: FetchFn = globalThis.fetch,
): ServiceResolver {
  const baseUrl = `http://${config.host}:${config.port}`;

  return {
    async resolve(serviceName: string): Promise<Result<string, ServiceResolveError>> {
      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/api/services`);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return err({ kind: "timeout" });
        }
        return err({ kind: "connection_refused" });
      }

      if (!response.ok) {
        const message = await response.text();
        return err({ kind: "api_error", status: response.status, message });
      }

      const services = await response.json() as OneCommeService[];
      const matches = services.filter((s) => s.name === serviceName);

      if (matches.length === 1) {
        return ok(matches[0].id);
      }

      if (matches.length === 0) {
        return err({
          kind: "not_found",
          serviceName,
          availableServices: services.map((s) => s.name),
        });
      }

      // 複数一致
      return err({
        kind: "ambiguous",
        serviceName,
        matches: matches.map((s) => ({ id: s.id, name: s.name })),
      });
    },
  };
}

/** ServiceResolveErrorをユーザー向けエラーメッセージに変換する */
export function formatServiceResolveError(error: ServiceResolveError): string {
  switch (error.kind) {
    case "not_found":
      return `エラー: サービス名「${error.serviceName}」に一致するサービスが見つかりません。\n利用可能なサービス名: ${error.availableServices.length > 0 ? error.availableServices.join(", ") : "(なし)"}`;
    case "ambiguous":
      return `エラー: サービス名「${error.serviceName}」に複数のサービスが一致しました。--service-id で直接指定してください。\n${error.matches.map((m) => `  - ${m.name} (ID: ${m.id})`).join("\n")}`;
    case "connection_refused":
      return "エラー: わんコメAPIへの接続が拒否されました。わんコメが起動しているか確認してください。";
    case "timeout":
      return "エラー: わんコメAPIへの接続がタイムアウトしました。";
    case "api_error":
      return `エラー: わんコメAPIがエラーを返しました (${error.status}): ${error.message}`;
  }
}
