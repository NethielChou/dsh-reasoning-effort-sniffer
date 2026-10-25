# dsh-reasoning-effort-sniffer

[![npm version](https://img.shields.io/npm/v/@nethiel/dsh-reasoning-effort-sniffer?logo=npm)](https://www.npmjs.com/package/@nethiel/dsh-reasoning-effort-sniffer)
[![license](https://img.shields.io/npm/l/@nethiel/dsh-reasoning-effort-sniffer)](./LICENSE)

给 **DeepSeek Harness（DSH）** 的第三方供应商补上「思考强度」：**实测嗅探**每个供应商的端点支持哪些档位，把档位声明写进 pi-ai 配置，然后你就可以在**输入框右下角的模型选择器**里像官方 DeepSeek 供应商一样切强度（Low / Medium / High / Max …）。

侧栏还有一个极简面板：**每个供应商一行，两个开关**（思考强度 / 嗅探）。

## 它解决什么问题

DSH 的 `llm-pi-ai` 适配器只有在模型显式声明 `reasoningEfforts` 之后，才会在模型选择器里给出思考强度控件。手工添加第三方供应商（OpenAI 兼容网关、聚合路由等）时没有人会去写这些声明，于是：

- 模型选择器里没有强度选项；
- 就算手写了声明，路由缺 `compat.supportsReasoningEffort: true` 时强度参数也不会真的发出去（选了等于没选）。

这个插件把这两件事都自动化了。

## 功能

- **自动嗅探**：对每个还没声明档位的对话模型，发两条极小的 `chat/completions` 请求（`reasoning_effort: "low"` 和 `"max"`），据此判断：
  - 完全不认这个参数 → 声明为非推理模型（记住结论，不再重复探测）；
  - 接受 `low` 与 `max` → 声明七档 `off…max`；
  - 只接受 `low` → 声明常用五档 `off…high`；
  - 鉴权失败 / 限流 / 超时 / 模型不存在 → 什么都不写，下一轮再试。
- **自动补 wire 标记**：已声明档位但缺 `compat.supportsReasoningEffort` 的供应商，自动补上（只补缺失项，不动其它 compat 字段）。
- **按供应商开关**（侧栏面板）：
  | 开关 | 开 | 关 |
  | --- | --- | --- |
  | 思考强度 | 该供应商的模型声明档位，选择器里可切强度 | 移除该供应商的档位声明，选择器不再提供强度 |
  | 嗅探 | 自动探测端点支持到哪一档 | 不联网，直接按七档声明 |
- **限速保护**：启动 5 秒后第一轮，之后每 60 秒一轮；每轮最多 20 条探测请求、间隔 1.5 秒（照顾 20 请求/分钟的网关）；跳过 OCR / embedding / rerank 等非对话模型。

> 选具体强度**不在这个插件里**：始终在输入框右下角的模型选择器里选，和官方 DeepSeek 供应商一致。

## 安装

### 从插件市场 / npm（推荐）

发布后可以直接装：

```bash
dsh plugin --profile web add @nethiel/dsh-reasoning-effort-sniffer
```

（`--profile` 换成你实际使用的 profile 名，例如 `desktop`；然后在 DSH 里重启一次。）

### 本地开发版

还没发布时，或想改代码时，手动装：

1. 把本仓库放到本地任意目录；
2. 打开 profile 目录 `%USERPROFILE%\.dsh\profiles\desktop\package.json`，在 `dependencies` 里加一行（路径换成你的实际位置）：
   ```json
   "@nethiel/dsh-reasoning-effort-sniffer": "file:E:/path/to/dsh-reasoning-effort-sniffer"
   ```
3. 在 `dsh.profile.bundles` 数组末尾加上 `"@nethiel/dsh-reasoning-effort-sniffer"`；
4. 在 profile 目录执行安装（DSH 自带的 node + pnpm）：
   ```powershell
   pnpm install --offline
   ```
5. 重启 DSH。

## 安全与隐私

- 插件**只**向你已经在 DSH 里配置过的供应商 `baseURL` 发请求，不会连接任何第三方服务器，也没有遥测。
- 嗅探请求是极小的普通对话请求：`max_tokens: 32`、内容 `ping`、额外带一个 `reasoning_effort` 字段；每个未声明模型最多两条。
- 密钥通过 DSH 的凭证服务（`ctx.credentials`）读取，**只放进请求头**；不写日志、不落盘、不进错误信息。
- 所有配置写入都走 DSH 的设置服务（带修订号 + pi-ai 自己的 schema 校验），不会绕过校验直接改文件。
- 侧栏面板的两个开关存在插件自己的配置命名空间里，随时可以在面板里关掉嗅探（不再联网）。

## 配置

插件开关存在它自己的配置命名空间 `reasoning-effort` 里（profile 的 `cordis.patch.yml`），一般不用手改：

```yaml
- id: reasoning-effort
  name: "@nethiel/dsh-reasoning-effort-sniffer"
  config:
    providers:
      your-route-id:
        reasoning: true   # 是否声明档位
        sniff: true       # 是否联网探测
```

缺省（不写）等于两个开关都开。

## 工作原理（简述）

- 数据来源是 `ctx.settings`（pi-ai 适配器的设置快照）与 `ctx.credentials`（密钥）；
- 每次写入都走 settings 服务的**带修订号**路径操作，Host 按 pi-ai 自己的 schema 校验，不会绕过校验硬改文件；
- 面板用 `configForms` 写插件自身配置，Host 监听 volatile 更新后**立即**执行声明/撤销（约 1 秒），不必等 60 秒轮询；
- 探测请求不会记录密钥，也不会把请求/响应正文写日志。

## 已知限制

- 只处理 `openai-completions` 协议的手工路由；catalog 路由与非 OpenAI 协议不碰。
- 「端点接受参数」不等于「后端真的按档位改变思考长度」，实际效果取决于网关实现。
- 某些模型关不掉思考（例如 GLM 系列），这类模型不会声明 `off` 档。
- 关掉再打开「思考强度」且嗅探开着时，会重新探测该供应商的模型，受每轮预算限制可能分几轮完成。

## 许可证

[MIT](./LICENSE)

