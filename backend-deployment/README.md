# 招生助手后端启动

同一个仓库包含前端、GraphRAG、DB-GPT 和数据库部署源码。以下命令从仓库根目录运行，适用于 Windows PowerShell。

## 准备依赖和索引

安装 PostgreSQL 16、uv 和 Node.js。已有招生资料时，把 Markdown 目录传给准备脚本。

```powershell
.\backend-deployment\scripts\prepare_local.ps1 -CorpusDir 'D:\path\to\doc'
```

直接运行该脚本会从招生官网采集资料。采集版的覆盖范围取决于可访问的页面。已有 GraphRAG 格式的语料时，可先放到 graphrag/data/pages.jsonl。

## 配置 PostgreSQL 和模型

在 PostgreSQL 中创建空库 admission_agent，通过 psql 导入 backend-deployment/sql/schema.sql 和 backend-deployment/sql/seed.sql。导入脚本包含建表操作，应在新库上执行。为招生服务创建只读用户，并授予该库连接权限、public schema 使用权限以及招生表的 SELECT 权限。

准备脚本会在 backend-deployment/.runtime 下创建配置文件，已有文件会被沿用。

- 在 db-mcp.env 填写 PostgreSQL 连接地址、端口、只读账号和口令。
- 在 qwen.env 填写 Qwen 兼容接口地址、API Key 和本地 DB-GPT 加密密钥。模型名为 qwen3.8-flash-next。
- 内网自签名证书环境沿用原部署的关闭证书校验设置。可信证书环境可在 vendor/DB-GPT/configs/whu-qwen.toml 中开启 DB-GPT 证书校验，并在启动脚本中同步 GraphRAG 独立页面的校验设置。

## 启动

```powershell
.\backend-deployment\scripts\start_local.ps1
```

脚本启动 GraphRAG、MCP 和 DB-GPT，并注册招生数据库和政策知识空间。服务使用本机地址。DB-GPT 为 15670 端口，GraphRAG 为 8090，MCP 为 8765。开发网页默认连接 15670。

在另一个终端进入 miniapp，执行 npm.cmd ci --legacy-peer-deps 和 npm.cmd run dev:h5，打开 http://localhost:10086。

## ReAct 调试台

本机调试时，用 `.ackend-deploymentscriptsstart_local.ps1 -DebugConsole` 启动后端。如果 15670 上已经运行了 DB-GPT，需要重启该进程，以便读取调试开关。

在 H5 打开 [ReAct 调试台](http://localhost:10086/#/pages/debug/index)，也可以在「我的」页面进入。控制台与咨询页使用同一个 `POST /api/v1/chat/admission-react` 接口。控制台按轮次显示实际发送给模型的系统提示、会话历史、工具回填、公开输出、原生推理字段，以及 SQL 或 GraphRAG 的工具返回。原生推理单独记录在本次调试会话中，仅供本机查看，刷新后清空。

如果 Taro 启动时切换了端口，使用终端显示的本机预览地址进入调试台。

咨询页显示每轮任务摘要和最终答案。模型服务缺少原生推理字段时，循环仍会处理工具调用和最终答案。

## 项目来源

- graphrag 来自原 GraphRAG 仓库的 d5b90fb，保留原作者的检索实现。 [原仓库](https://github.com/Estrella-cloud/whu-admissions-graphrag)
- vendor/DB-GPT 基于 DB-GPT 5b30ad7 和招生整合提交 4976366，完整许可证随代码保存在该目录。 [DB-GPT 原仓库](https://github.com/eosphoros-ai/DB-GPT)

密钥、运行数据库、向量模型和生成索引保存在各自的本机目录。SQL 种子数据随仓库提供。
