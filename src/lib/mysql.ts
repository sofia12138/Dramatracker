/**
 * MySQL 连接层
 * 通过环境变量 USE_MYSQL=true 启用，否则系统继续使用 SQLite。
 * 连接配置从环境变量读取，不硬编码任何凭据。
 */
import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

function getPoolConfig(): mysql.PoolOptions {
  const host = process.env.MYSQL_HOST;
  const port = parseInt(process.env.MYSQL_PORT || '3306');
  const user = process.env.MYSQL_USER;
  const password = process.env.MYSQL_PASSWORD;
  const database = process.env.MYSQL_DATABASE;

  if (!host || !user || !password || !database) {
    throw new Error(
      '[mysql] 缺少必要环境变量：MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE'
    );
  }

  return {
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+00:00',
    charset: 'utf8mb4',
  };
}

export function getMysqlPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool(getPoolConfig());
    console.log('[mysql] 连接池已初始化');
  }
  return pool;
}

export async function closeMysqlPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[mysql] 连接池已关闭');
  }
}

/** 判断当前是否启用 MySQL 模式 */
export function isMysqlMode(): boolean {
  return process.env.USE_MYSQL === 'true';
}

/** 执行查询，返回结果行数组 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getMysqlPool();
  const [rows] = await pool.execute(sql, params as never);
  return rows as T[];
}

/** 执行写入（INSERT / UPDATE / DELETE），返回结果元信息 */
export async function execute(
  sql: string,
  params?: unknown[]
): Promise<mysql.ResultSetHeader> {
  const pool = getMysqlPool();
  const [result] = await pool.execute(sql, params as never);
  return result as mysql.ResultSetHeader;
}

/** 在事务中执行一组操作 */
export async function withTransaction<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const pool = getMysqlPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
