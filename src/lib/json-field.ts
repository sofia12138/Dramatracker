/**
 * 安全解析 mysql2/sqlite 返回的 JSON 字段。
 *
 * 背景：
 *   - SQLite (better-sqlite3) 把 TEXT/JSON 列读成原始字符串
 *   - MySQL (mysql2) 对 JSON 列【会自动 JSON.parse】，返回 array/object
 *
 * 直接对 row.xxx 调 JSON.parse 在两种数据源下行为不一致：
 *   - SQLite 走 OK
 *   - MySQL 拿到的 row.xxx 已经是对象 → JSON.parse(object) 会抛 SyntaxError
 *     (其实是 "[object Object]" is not valid JSON)
 *
 * 用本函数统一处理，调用方无需关心底层数据源类型。
 *
 * @example
 *   const tags = parseJsonField<string[]>(row.tags, []);
 *   const cfg  = parseJsonField<Record<string, unknown>>(row.payload_summary, {});
 */
export function parseJsonField<T = unknown>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

/**
 * 把 mysql2 / better-sqlite3 取到的 JSON 字段统一序列化成"前端期望的字符串"。
 *
 * 背景：
 *   - SQLite 把 JSON 列读成原始字符串，前端历史代码会再 JSON.parse 一次。
 *   - MySQL JSON 列被 mysql2 自动 parse 成 array/object，
 *     前端 JSON.parse(array) 直接抛错并把 tags 等字段当成空数组吞掉。
 *
 * 用本函数在 API 出口做归一化，前端契约保持不变（始终拿到 JSON 字符串或 null）。
 *
 *   - null/undefined  → null
 *   - 已是 string     → 原样返回（保持兼容 SQLite）
 *   - 其它（数组/对象/数字/布尔）→ JSON.stringify
 */
export function stringifyJsonField(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}
