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
