import { createLogger } from "./logger.js";

const logger = createLogger("DuplicateFilter");

const DEFAULT_MAX_SIZE = 10_000;

export interface DuplicateFilter {
  isDuplicate(commentId: string): boolean;
  markSent(commentId: string): void;
  size(): number;
}

/** DuplicateFilterを生成する */
export function createDuplicateFilter(
  maxSize: number = DEFAULT_MAX_SIZE,
): DuplicateFilter {
  const sentIds = new Set<string>();

  return {
    isDuplicate(commentId: string): boolean {
      return sentIds.has(commentId);
    },

    markSent(commentId: string): void {
      sentIds.add(commentId);

      if (sentIds.size > maxSize) {
        // Set は挿入順序を保持するので、最初の要素が最古
        const oldest = sentIds.values().next().value;
        if (oldest !== undefined) {
          sentIds.delete(oldest);
        }
      }
    },

    size(): number {
      return sentIds.size;
    },
  };
}
