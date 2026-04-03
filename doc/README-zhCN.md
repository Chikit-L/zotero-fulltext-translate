# Zotero 全文翻译插件

英文主页见：[README.md](../README.md)

这是一个 Zotero 全文翻译插件，通过 MinerU 解析 PDF，再调用 Translate for Zotero 完成全文翻译。

## 主要功能

- 将 Zotero 条目下的本地 PDF 重构为适合阅读的 HTML
- 通过 Translate for Zotero 执行翻译
- 生成 HTML 结果附件并回写到原条目
- 生成的 HTML 支持纯中文和中英两种阅读模式

## 使用方法

1. 在 Zotero 中选择一个带有本地 PDF 附件的条目。
2. 右键点击条目，选择 `全文翻译`。
3. 插件将翻译结果生成为 HTML 附件，并添加回原条目。

## 效果预览

- [点击查看示例翻译结果 HTML](https://chikit-l.github.io/zotero-fulltext-translate/examples/GreatBarrierReef.translated.html)

## 提示

强烈建议申请 MinerU API Token，以便使用精准解析 API。

| 对比维度 | 🎯 精准解析 API | ⚡ Agent 轻量解析 API |
| --- | --- | --- |
| 是否需要 Token | ✅ 需要 | ❌ 无需，按 IP 限频 |
| 接口地址 | `/api/v4/extract/task` 或 `/api/v4/file-urls/batch` | `/api/v1/agent/parse/url` 或 `/api/v1/agent/parse/file` |
| 模型版本 | `pipeline` 默认，推荐 `vlm`，也支持 `MinerU-HTML` | 固定为轻量 `pipeline` 模型 |
| 文件大小限制 | ≤ 200MB | ≤ 10MB |
| 页数限制 | ≤ 600 页 | ≤ 20 页 |
| 批量支持 | ✅ 支持，最多 200 个 | ❌ 仅支持单文件 |
| 输出格式 | Zip 包，包含 Markdown、JSON，且可导出为 docx/html/latex | 仅 Markdown，结果通过 CDN 链接返回 |
| 调用方式 | 异步，提交后轮询 | 异步，提交后轮询 |

## 依赖要求

- Zotero 7
- 必须安装 [Translate for Zotero](https://github.com/windingwind/zotero-pdf-translate)
- 条目下存在本地 PDF 附件
- 可选但强烈建议：MinerU API Token


## 安装

如果仓库已经发布 Release，可以直接从 GitHub Releases 下载 `.xpi` 安装包。

如果你需要 Zotero 自动更新使用的在线更新地址，可以使用：

- `https://chikit-l.github.io/zotero-fulltext-translate/update.json`

如果你是从源码构建：

```bash
npm install
npm run build
```

构建完成后，将 `.scaffold/build/` 下生成的 `.xpi` 文件安装到 Zotero 中。

## 致谢

本项目在开发过程中参考了以下项目：

- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 提供的插件脚模板与构建流程
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero#readme) 中关于 MinerU 相关功能的实现思路
- [zotero-style](https://github.com/MuiseDestiny/zotero-style#readme) 中全文翻译结果展示效果的设计思路

## 许可证

GNU Affero General Public License v3.0
