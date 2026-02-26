/** 成功/失敗を明示的に表現するResult型 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

/** 成功結果を生成する */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** 失敗結果を生成する */
export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Result が成功かどうか判定する */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

/** Result が失敗かどうか判定する */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** 成功結果の値を取り出す。失敗の場合はthrowする */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw new Error(`unwrap called on Err: ${JSON.stringify(result.error)}`);
}
