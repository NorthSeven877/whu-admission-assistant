# -*- coding: utf-8 -*-
"""数据库 MCP 服务器：把 admission_agent 库封装成 MCP 工具（SSE 传输）。

暴露工具：
  - list_tables()                 列出库内所有表
  - describe_table(table_name)    查看某张表的列名与类型
  - run_sql(sql)                  执行只读 SQL（仅放行 SELECT / WITH）

启动：
  python db_mcp_server.py
  # 默认监听 http://127.0.0.1:8765/sse

可用环境变量覆盖：
  DB_MCP_HOST      监听地址，默认 127.0.0.1
  DB_MCP_PORT      监听端口，默认 8765
  DB_MCP_PG_HOST   PostgreSQL 主机，默认 localhost
  DB_MCP_PG_PORT   PostgreSQL 端口，默认 5432
  DB_MCP_PG_DB     库名，默认 admission_agent
  DB_MCP_PG_USER   用户，默认 postgres
  DB_MCP_PG_PASSWORD 密码，必须通过环境变量提供
  DB_MCP_PG_DSN    完整 DSN，若设置则覆盖以上各项
"""
import datetime
import decimal
import json
import logging
import os

import psycopg2

try:
    from mcp.server.fastmcp import FastMCP
    MCP_V2 = False
except ModuleNotFoundError as exc:
    if exc.name != "mcp.server.fastmcp":
        raise
    from mcp.server import MCPServer
    MCP_V2 = True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DB-MCP] %(levelname)s %(message)s",
)
logger = logging.getLogger("db_mcp")

# ── 连接配置 ────────────────────────────────────────────────
PG_DSN = os.environ.get("DB_MCP_PG_DSN")
PG_CONN_KW = {
    "host": os.environ.get("DB_MCP_PG_HOST", "localhost"),
    "port": int(os.environ.get("DB_MCP_PG_PORT", "5432")),
    "dbname": os.environ.get("DB_MCP_PG_DB", "admission_agent"),
    "user": os.environ.get("DB_MCP_PG_USER", "postgres"),
    "password": os.environ.get("DB_MCP_PG_PASSWORD", ""),
    # 中文列必须显式 UTF8，否则会抛 UnicodeDecodeError
    "options": "-c client_encoding=UTF8",
}

SERVER_HOST = os.environ.get("DB_MCP_HOST", "127.0.0.1")
SERVER_PORT = int(os.environ.get("DB_MCP_PORT", "8765"))

if MCP_V2:
    mcp = MCPServer(
        name="admission-db-mcp",
        description="湖北招生录取数据库（admission_agent）查询 MCP 服务器",
    )
else:
    mcp = FastMCP(
        name="admission-db-mcp",
        instructions="湖北招生录取数据库（admission_agent）查询 MCP 服务器",
        host=SERVER_HOST,
        port=SERVER_PORT,
    )


def _connect():
    if PG_DSN:
        conn = psycopg2.connect(PG_DSN)
    else:
        conn = psycopg2.connect(**PG_CONN_KW)
    conn.set_session(readonly=True)
    return conn


def _json_default(o):
    """把 Decimal / 日期 转成可 JSON 序列化的形式，避免数字被变成字符串。"""
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (datetime.datetime, datetime.date)):
        return o.isoformat()
    return str(o)


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, default=_json_default)


@mcp.tool()
def list_tables() -> str:
    """列出数据库中所有表名，返回 JSON 数组。"""
    logger.info("tools/call list_tables")
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' ORDER BY table_name"
            )
            tables = [r[0] for r in cur.fetchall()]
    return _dumps(tables)


@mcp.tool()
def describe_table(table_name: str) -> str:
    """查看指定表的列名与数据类型，返回 JSON 对象。"""
    logger.info("tools/call describe_table table=%s", table_name)
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = %s "
                "ORDER BY ordinal_position",
                (table_name,),
            )
            columns = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
    return _dumps({"table": table_name, "columns": columns})


@mcp.tool()
def run_sql(sql: str) -> str:
    """执行只读 SQL（仅允许 SELECT / WITH），返回 {columns, rows, row_count}。"""
    logger.info("tools/call run_sql sql=%s", sql.replace("\n", " ")[:200])
    stripped = sql.strip().rstrip(";")
    head = stripped.lstrip().lower()
    if not (head.startswith("select") or head.startswith("with")):
        return _dumps({"error": "仅允许只读查询（SELECT / WITH）"})
    try:
        with _connect() as conn:
            with conn.cursor() as cur:
                cur.execute(stripped)
                columns = [d[0] for d in cur.description] if cur.description else []
                rows = [list(r) for r in cur.fetchall()]
    except Exception as e:  # noqa: BLE001
        logger.exception("run_sql failed")
        return _dumps({"error": str(e)})
    return _dumps({"columns": columns, "rows": rows, "row_count": len(rows)})


if __name__ == "__main__":
    logger.info(
        "启动 admission-db-mcp，SSE 端点 http://%s:%s/sse （库=%s）",
        SERVER_HOST,
        SERVER_PORT,
        PG_CONN_KW["dbname"],
    )
    if MCP_V2:
        mcp.run(transport="sse", host=SERVER_HOST, port=SERVER_PORT, sse_path="/sse")
    else:
        mcp.run(transport="sse")
