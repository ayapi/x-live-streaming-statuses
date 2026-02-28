import type { Result } from "./result.js";
import type { OneCommeService, ServiceTarget, ResolvedService, ServiceResolveError } from "./types.js";
import { ok, err } from "./result.js";

export interface ServiceResolver {
  resolve(target: ServiceTarget): Promise<Result<ResolvedService, ServiceResolveError>>;
}

type FetchFn = typeof globalThis.fetch;

/**
 * わんコメAPIからサービス情報を解決するServiceResolverを生成する。
 * ServiceTargetのkindに応じて名前検索またはID検索を行い、
 * サービスIDとURLを含むResolvedServiceを返す。
 * fetchFnパラメータでDI可能（テスト時にモック注入）。
 */
export function createServiceResolver(
  config: { host: string; port: number },
  fetchFn: FetchFn = globalThis.fetch,
): ServiceResolver {
  const baseUrl = `http://${config.host}:${config.port}`;

  return {
    async resolve(target: ServiceTarget): Promise<Result<ResolvedService, ServiceResolveError>> {
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

      if (target.kind === "name") {
        const serviceName = target.serviceName;
        const matches = services.filter((s) => s.name === serviceName);

        if (matches.length === 0) {
          return err({
            kind: "not_found",
            serviceName,
            availableServices: services.map((s) => s.name),
          });
        }

        if (matches.length > 1) {
          return err({
            kind: "ambiguous",
            serviceName,
            matches: matches.map((s) => ({ id: s.id, name: s.name })),
          });
        }

        const service = matches[0];
        if (!service.url) {
          return err({
            kind: "url_not_found",
            serviceId: service.id,
            serviceName: service.name,
          });
        }

        return ok({ serviceId: service.id, url: service.url });
      }

      // kind === "id"
      const serviceId = target.serviceId;
      const service = services.find((s) => s.id === serviceId);

      if (!service) {
        return err({ kind: "id_not_found", serviceId });
      }

      if (!service.url) {
        return err({
          kind: "url_not_found",
          serviceId: service.id,
          serviceName: service.name,
        });
      }

      return ok({ serviceId: service.id, url: service.url });
    },
  };
}

/** ServiceResolveErrorをユーザー向けエラーメッセージに変換する */
export function formatServiceResolveError(error: ServiceResolveError): string {
  switch (error.kind) {
    case "not_found":
      return `エラー: サービス名「${error.serviceName}」に一致するサービスが見つかりません。\n利用可能なサービス名: ${error.availableServices.length > 0 ? error.availableServices.join(", ") : "(なし)"}`;
    case "id_not_found":
      return `エラー: サービスID「${error.serviceId}」に一致するサービスが見つかりません。`;
    case "url_not_found":
      return `エラー: サービス「${error.serviceName}」（ID: ${error.serviceId}）にURLが設定されていません。わんコメで枠のURLを設定するか、broadcast-urlを直接指定してください。`;
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
