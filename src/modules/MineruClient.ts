import { getPref } from "../utils/prefs";
import { TranslationControl } from "./TranslationControl";

export type MineruStructuredBlock =
  | {
      type: "text";
      text: string;
      level?: number;
    }
  | {
      type: "table";
      caption?: string;
      html: string;
    }
  | {
      type: "image";
      caption?: string;
      dataUrl?: string;
    };

export type MineruParseResult = {
  markdown: string;
  blocks?: MineruStructuredBlock[];
  markdownImageMap?: Record<string, string>;
};

type MineruCode = string | number;

type AgentCreateResponse = {
  code: MineruCode;
  msg: string;
  data?: {
    task_id: string;
    file_url: string;
  };
};

type AgentPollResponse = {
  code: MineruCode;
  msg: string;
  data?: {
    task_id: string;
    state:
      | "waiting-file"
      | "uploading"
      | "pending"
      | "running"
      | "done"
      | "failed";
    markdown_url?: string;
    err_msg?: string;
    err_code?: MineruCode;
  };
};

type BatchCreateResponse = {
  code: MineruCode;
  msg: string;
  data?: {
    batch_id: string;
    file_urls: string[];
  };
};

type BatchPollResponse = {
  code: MineruCode;
  msg: string;
  data?: {
    batch_id: string;
    extract_result: Array<{
      file_name: string;
      state:
        | "waiting-file"
        | "pending"
        | "running"
        | "done"
        | "failed"
        | "converting";
      full_zip_url?: string;
      err_msg?: string;
    }>;
  };
};

export class MineruClient {
  private static readonly preciseBase = "https://mineru.net/api/v4";

  private static readonly agentBase = "https://mineru.net/api/v1/agent";

  static async parsePDF(filePath: string, fileName: string): Promise<MineruParseResult> {
    const token = String(getPref("mineruToken") || "").trim();
    const mode = token ? "precise" : "agent";
    try {
      TranslationControl.throwIfStopped();
      if (token) {
        return await this.parseWithPreciseAPI(filePath, fileName, token);
      }
      return await this.parseWithAgentAPI(filePath, fileName);
    } catch (error) {
      throw new Error(this.humanizeMineruError(error, mode));
    }
  }

  private static async parseWithAgentAPI(
    filePath: string,
    fileName: string,
  ): Promise<MineruParseResult> {
    const createRes = (await this.requestJSON(
      "POST",
      `${this.agentBase}/parse/file`,
      this.buildAgentPayload(fileName),
    )) as AgentCreateResponse;

    if (createRes.code !== 0 || !createRes.data) {
      throw new Error(this.formatAgentCodeMessage(createRes.code, createRes.msg));
    }

    TranslationControl.throwIfStopped();
    let binary: Uint8Array;
    try {
      ztoolkit.log(`[Full Text Translate] Reading local PDF: ${filePath}`);
      binary = await this.readBinary(filePath);
      ztoolkit.log(`[Full Text Translate] Local PDF loaded: ${binary.byteLength} bytes`);
    } catch (error) {
      const detail = this.extractErrorMessage(error);
      throw new Error(
        `读取本地 PDF 失败${detail ? `：${detail}` : "。请确认附件可正常打开，且已完整下载到本地。"}`,
      );
    }

    try {
      ztoolkit.log("[Full Text Translate] Uploading PDF to MinerU agent");
      TranslationControl.throwIfStopped();
      await this.requestRaw("PUT", createRes.data.file_url, binary);
      ztoolkit.log("[Full Text Translate] PDF upload finished (agent)");
    } catch (error) {
      const detail = this.extractErrorMessage(error);
      throw new Error(`MinerU 轻量解析上传 PDF 失败${detail ? `：${detail}` : "。"}`);
    }

    const taskID = createRes.data.task_id;
    const done = await this.poll(async () => {
      TranslationControl.throwIfStopped();
      const pollRes = (await this.requestJSON(
        "GET",
        `${this.agentBase}/parse/${taskID}`,
      )) as AgentPollResponse;
      if (pollRes.code !== 0 || !pollRes.data) {
        throw new Error(this.formatAgentCodeMessage(pollRes.code, pollRes.msg));
      }
      if (pollRes.data.state === "failed") {
        throw new Error(
          this.formatAgentCodeMessage(
            pollRes.data.err_code,
            pollRes.data.err_msg || pollRes.msg,
          ),
        );
      }
      if (pollRes.data.state === "done" && pollRes.data.markdown_url) {
        return pollRes.data.markdown_url;
      }
      return null;
    });

    return {
      markdown: await this.downloadText(done),
    };
  }

  private static async parseWithPreciseAPI(
    filePath: string,
    fileName: string,
    token: string,
  ): Promise<MineruParseResult> {
    const createRes = (await this.requestJSON(
      "POST",
      `${this.preciseBase}/file-urls/batch`,
      this.buildPrecisePayload(fileName),
      this.buildAuthHeaders(token),
    )) as BatchCreateResponse;

    if (
      createRes.code !== 0 ||
      !createRes.data?.batch_id ||
      !createRes.data.file_urls?.length
    ) {
      throw new Error(this.formatPreciseCodeMessage(createRes.code, createRes.msg));
    }

    TranslationControl.throwIfStopped();
    let binary: Uint8Array;
    try {
      ztoolkit.log(`[Full Text Translate] Reading local PDF: ${filePath}`);
      binary = await this.readBinary(filePath);
      ztoolkit.log(`[Full Text Translate] Local PDF loaded: ${binary.byteLength} bytes`);
    } catch (error) {
      const detail = this.extractErrorMessage(error);
      throw new Error(
        `读取本地 PDF 失败${detail ? `：${detail}` : "。请确认附件可正常打开，且已完整下载到本地。"}`,
      );
    }

    try {
      ztoolkit.log("[Full Text Translate] Uploading PDF to MinerU precise API");
      TranslationControl.throwIfStopped();
      await this.requestRaw("PUT", createRes.data.file_urls[0], binary);
      ztoolkit.log("[Full Text Translate] PDF upload finished (precise)");
    } catch (error) {
      const detail = this.extractErrorMessage(error);
      throw new Error(`MinerU 精准解析上传 PDF 失败${detail ? `：${detail}` : "。"}`);
    }

    const batchID = createRes.data.batch_id;
    const zipURL = await this.poll(async () => {
      TranslationControl.throwIfStopped();
      const pollRes = (await this.requestJSON(
        "GET",
        `${this.preciseBase}/extract-results/batch/${batchID}`,
        undefined,
        this.buildAuthHeaders(token),
      )) as BatchPollResponse;
      const result = pollRes.data?.extract_result?.[0];
      if (pollRes.code !== 0 || !result) {
        throw new Error(this.formatPreciseCodeMessage(pollRes.code, pollRes.msg));
      }
      if (result.state === "failed") {
        throw new Error(this.formatPreciseCodeMessage(undefined, result.err_msg));
      }
      if (result.state === "done" && result.full_zip_url) {
        return result.full_zip_url;
      }
      return null;
    }, 600000);

    return this.extractPreciseResultFromZipURL(zipURL);
  }

  private static buildAgentPayload(fileName: string) {
    const normalizedFileName = this.normalizeMineruFileName(fileName);
    return {
      file_name: normalizedFileName,
      language: getPref("mineruLanguage") || "en",
      enable_table: Boolean(getPref("mineruEnableTable")),
      is_ocr: Boolean(getPref("mineruEnableOCR")),
      enable_formula: Boolean(getPref("mineruEnableFormula")),
    };
  }

  private static buildPrecisePayload(fileName: string) {
    const normalizedFileName = this.normalizeMineruFileName(fileName);
    return {
      files: [
        {
          name: normalizedFileName,
          is_ocr: Boolean(getPref("mineruEnableOCR")),
        },
      ],
      language: getPref("mineruLanguage") || "en",
      enable_table: Boolean(getPref("mineruEnableTable")),
      enable_formula: Boolean(getPref("mineruEnableFormula")),
      enable_page_ocr: Boolean(getPref("mineruEnableOCR")),
      layout_model: "doclayout_yolo",
    };
  }

  private static normalizeMineruFileName(fileName: string) {
    const trimmed = String(fileName || "").trim() || "document.pdf";
    const extMatch = trimmed.match(/(\.[A-Za-z0-9]+)$/);
    const ext = extMatch?.[1] || ".pdf";
    const base = trimmed.slice(0, trimmed.length - ext.length) || "document";
    const normalizedBase = base.replace(/[^\x20-\x7E]/g, "_").replace(/[^A-Za-z0-9._-]/g, "_");
    const collapsedBase = normalizedBase.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
    return `${collapsedBase || "document"}${ext.toLowerCase()}`;
  }

  private static buildAuthHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private static async requestJSON(
    method: "GET" | "POST",
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const xhr = await Zotero.HTTP.request(method, url, {
      responseType: "json",
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
    });
    return xhr.response;
  }

  private static async requestRaw(
    method: "PUT",
    url: string,
    body: Uint8Array,
  ) {
    const fetchFn =
      (ztoolkit.getGlobal("fetch") as typeof fetch | undefined) ||
      (globalThis as { fetch?: typeof fetch }).fetch;

    if (fetchFn) {
      try {
        const response = await fetchFn(url, {
          method,
          body: new Uint8Array(body),
        });
        if (response.status >= 200 && response.status < 300) {
          return;
        }
        const responseText = String(await response.text().catch(() => "")).slice(0, 500);
        throw new Error(
          `HTTP ${method} ${url} failed with status code ${response.status}${responseText ? `: ${responseText}` : ""}`,
        );
      } catch (error) {
        ztoolkit.log("[Full Text Translate] Fetch upload failed, fallback to XHR", error);
      }
    }

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.timeout = 120000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          const responseText = String(xhr.responseText || "").slice(0, 500);
          reject(
            new Error(
              `HTTP ${method} ${url} failed with status code ${xhr.status}${responseText ? `: ${responseText}` : ""}`,
            ),
          );
        }
      };
      xhr.onerror = () => {
        reject(new Error(`HTTP ${method} ${url} failed during network transfer`));
      };
      xhr.onabort = () => {
        reject(new Error(`HTTP ${method} ${url} was aborted during upload`));
      };
      xhr.ontimeout = () => {
        reject(new Error(`HTTP ${method} ${url} timed out during upload`));
      };
      try {
        xhr.send(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
      } catch (error) {
        const detail = this.extractErrorMessage(error);
        reject(new Error(`HTTP ${method} ${url} could not start upload${detail ? `: ${detail}` : ""}`));
      }
    });
  }

  private static async readBinary(path: string): Promise<Uint8Array> {
    const ioUtils = (globalThis as {
      IOUtils?: {
        read?: (path: string) => Promise<Uint8Array | ArrayBuffer | ArrayBufferView>;
      };
    }).IOUtils;
    if (ioUtils?.read) {
      const data = await ioUtils.read(path);
      if (data instanceof Uint8Array) {
        return data;
      }
      if (data instanceof ArrayBuffer) {
        return new Uint8Array(data);
      }
      if (ArrayBuffer.isView(data)) {
        return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      }
    }

    const osFile = (globalThis as {
      OS?: { File?: { read?: (path: string) => Promise<Uint8Array | ArrayBuffer> } };
    }).OS?.File;
    if (osFile?.read) {
      const data = await osFile.read(path);
      if (data instanceof Uint8Array) {
        return data;
      }
      return new Uint8Array(data);
    }

    const text = (await Zotero.File.getBinaryContentsAsync(path)) as string;
    return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
  }

  private static async downloadText(url: string): Promise<string> {
    const xhr = await Zotero.HTTP.request("GET", url, {
      responseType: "text",
    });
    return xhr.responseText as string;
  }

  private static async downloadToTempFile(
    url: string,
    fileName: string,
  ): Promise<string> {
    const tmpDir = Zotero.getTempDirectory().path;
    await Zotero.File.createDirectoryIfMissingAsync(tmpDir);
    const target = PathUtils.join(tmpDir, fileName);
    await (Zotero.HTTP as any).download(url, target);
    return target;
  }

  private static async extractPreciseResultFromZipURL(zipURL: string): Promise<MineruParseResult> {
    const zipPath = await this.downloadToTempFile(
      zipURL,
      `mineru-${Date.now()}.zip`,
    );
    const reader = (Components.classes as any)[
      "@mozilla.org/libjar/zip-reader;1"
    ].createInstance(Components.interfaces.nsIZipReader);
    const zipFile = Zotero.File.pathToFile(zipPath);
    reader.open(zipFile);
    try {
      let markdown = "";
      let contentListEntry = "";
      const entries = reader.findEntries("*");
      while (entries.hasMore()) {
        const entry = entries.getNext();
        if (typeof entry !== "string") {
          continue;
        }
        if (!markdown && /(^|\/)full\.md$/i.test(entry)) {
          markdown = await this.readTextEntry(reader, entry);
          continue;
        }
        if (!contentListEntry && /(^|\/).+_content_list\.json$/i.test(entry)) {
          contentListEntry = entry;
        }
      }

      if (!markdown) {
        throw new Error("MinerU 解析结果不完整：返回的压缩包中缺少 full.md。");
      }

        const markdownImageMap = await this.buildMarkdownImageMap(reader, markdown);

        if (!contentListEntry) {
          return { markdown, markdownImageMap };
        }

      try {
        const rawContent = JSON.parse(
          await this.readTextEntry(reader, contentListEntry),
        ) as unknown;
        if (!Array.isArray(rawContent)) {
          return { markdown };
        }
        const blocks = await this.buildStructuredBlocks(
          reader,
          rawContent as Array<Record<string, unknown>>,
        );
        return {
          markdown,
          blocks: blocks.length ? blocks : undefined,
          markdownImageMap,
        };
      } catch (error) {
        ztoolkit.log("Structured MinerU parse failed, fallback to full.md", error);
        return { markdown, markdownImageMap };
      }
    } finally {
      reader.close();
    }
  }

  private static async buildStructuredBlocks(
    reader: nsIZipReader,
    rawContent: Array<Record<string, unknown>>,
  ): Promise<MineruStructuredBlock[]> {
    const blocks: MineruStructuredBlock[] = [];

    for (const rawBlock of rawContent) {
      const type = String(rawBlock.type || "").trim();
      if (type === "text") {
        const text = String(rawBlock.text || "").trim();
        if (!text) {
          continue;
        }
        const level =
          typeof rawBlock.text_level === "number"
            ? rawBlock.text_level
            : undefined;
        blocks.push({
          type: "text",
          text,
          level,
        });
        continue;
      }

      if (type === "table") {
        const caption = this.readCaption(rawBlock, ["table_caption", "caption"]);
        const html = String(rawBlock.table_body || "").trim();
        if (!caption && !html) {
          continue;
        }
        blocks.push({
          type: "table",
          caption: caption || undefined,
          html,
        });
        continue;
      }

      if (type === "image") {
        const caption = this.readCaption(rawBlock, ["img_caption", "image_caption", "caption"]);
        const entryPath = String(rawBlock.img_path || "").trim();
        let dataUrl: string | undefined;
        if (entryPath) {
          try {
            dataUrl = await this.extractImageDataURL(reader, entryPath);
          } catch (error) {
            ztoolkit.log(`Image extraction failed for ${entryPath}`, error);
          }
        }
        if (!caption && !dataUrl) {
          continue;
        }
        blocks.push({
          type: "image",
          caption: caption || undefined,
          dataUrl,
        });
      }
    }

    return blocks;
  }

  private static readCaption(
    rawBlock: Record<string, unknown>,
    keys: string[],
  ): string {
    for (const key of keys) {
      const value = rawBlock[key];
      if (Array.isArray(value)) {
        const merged = value
          .map((part) => String(part || "").trim())
          .filter(Boolean)
          .join(" ")
          .trim();
        if (merged) {
          return merged;
        }
      }
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return "";
  }

  private static async readTextEntry(reader: nsIZipReader, entry: string) {
    const stream = reader.getInputStream(entry);
    return (await Zotero.File.getContentsAsync(stream, "utf-8")) as string;
  }

  private static async extractImageDataURL(
    reader: nsIZipReader,
    entry: string,
  ): Promise<string | undefined> {
    const resolvedEntry = this.resolveZipEntry(reader, entry);
    if (!resolvedEntry) {
      return undefined;
    }
    const stream = reader.getInputStream(resolvedEntry);
    const binaryStream = (Components.classes as any)[
      "@mozilla.org/binaryinputstream;1"
    ].createInstance(Components.interfaces.nsIBinaryInputStream);
    binaryStream.setInputStream(stream);
    let binary = "";
    try {
      while (binaryStream.available() > 0) {
        binary += binaryStream.readBytes(binaryStream.available());
      }
    } finally {
      binaryStream.close();
      stream.close();
    }
    if (!binary) {
      return undefined;
    }
    const ext = resolvedEntry.split(".").pop()?.toLowerCase() || "png";
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "gif"
          ? "image/gif"
          : ext === "webp"
            ? "image/webp"
            : "image/png";
    return `data:${mime};base64,${btoa(binary)}`;
  }

  private static async buildMarkdownImageMap(
    reader: nsIZipReader,
    markdown: string,
  ): Promise<Record<string, string>> {
    const refs = Array.from(
      markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g),
      (match) => String(match[1] || "").trim(),
    ).filter(Boolean);
    const uniqueRefs = [...new Set(refs)];
    const imageMap: Record<string, string> = {};
    for (const ref of uniqueRefs) {
      if (/^(?:https?:|data:)/i.test(ref)) {
        continue;
      }
      const dataUrl = await this.extractImageDataURL(reader, ref);
      if (dataUrl) {
        imageMap[ref] = dataUrl;
      }
    }
    return imageMap;
  }

  private static resolveZipEntry(reader: nsIZipReader, entry: string): string | null {
    const normalizedEntry = entry.replace(/\\/g, "/");
    const entries = reader.findEntries("*");
    while (entries.hasMore()) {
      const current = entries.getNext();
      if (typeof current !== "string") {
        continue;
      }
      const normalizedCurrent = current.replace(/\\/g, "/");
      if (
        normalizedCurrent === normalizedEntry ||
        normalizedCurrent.endsWith(`/${normalizedEntry}`)
      ) {
        return current;
      }
    }
    return null;
  }

  private static async poll<T>(
    fn: () => Promise<T | null>,
    timeout = 300000,
    interval = 3000,
  ): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      TranslationControl.throwIfStopped();
      const result = await fn();
      if (result !== null) {
        return result;
      }
      await Zotero.Promise.delay(interval);
    }
    throw new Error("MinerU polling timed out");
  }

  private static humanizeMineruError(error: unknown, mode: "precise" | "agent") {
    const message = this.extractErrorMessage(error);
    if (!message) {
      return mode === "precise"
        ? "MinerU 精准解析失败，请检查设置后重试。"
        : "MinerU 轻量解析失败，请稍后重试。";
    }

    if (/^MinerU /.test(message) || /^轻量解析 /.test(message) || /^精准解析 /.test(message)) {
      return message;
    }

    const httpMessage = this.formatMineruHTTPMessage(message, mode);
    if (httpMessage) {
      return httpMessage;
    }

    if (/polling timed out/i.test(message)) {
      return mode === "precise"
        ? "MinerU 精准解析等待超时。任务可能仍在服务器处理中，请稍后重试。"
        : "MinerU 轻量解析等待超时。轻量接口可能正在排队，请稍后重试。";
    }

    return mode === "precise"
      ? `MinerU 精准解析失败：${message}`
      : `MinerU 轻量解析失败：${message}`;
  }

  private static formatMineruHTTPMessage(message: string, mode: "precise" | "agent") {
    const match = message.match(/HTTP\s+(GET|POST|PUT|DELETE)\s+(\S+)\s+failed with status code\s+(\d{3})/i);
    if (!match) {
      return "";
    }

    const [, method, url, statusText] = match;
    const status = Number(statusText);

    if (mode === "precise") {
      if (status === 401) {
        return "MinerU 精准解析 API 认证失败（401）。请检查 Token 是否正确、是否已过期，且不要手动填写 Bearer 前缀。";
      }
      if (status === 403) {
        return method.toUpperCase() === "PUT"
          ? "MinerU 精准解析文件上传被拒绝（403）。上传签名可能已失效，请稍后重试。"
          : "MinerU 精准解析请求被拒绝（403）。请检查 Token 权限或稍后重试。";
      }
      if (status === 429) {
        return "MinerU 精准解析请求过于频繁（429）。请稍后再试。";
      }
      if (status === 408 || status === 504) {
        return "MinerU 精准解析请求超时。可能是文件较大或服务响应较慢，请稍后重试。";
      }
      if (status >= 500) {
        return `MinerU 精准解析服务暂时不可用（${status}）。请稍后重试。`;
      }
      return `MinerU 精准解析请求失败（${status}）。请检查 Token 和参数设置。`;
    }

    if (status === 429) {
      return "MinerU 轻量解析接口请求过于频繁（429）。该模式按 IP 限频，请稍后再试，或填写 Token 改用精准解析 API。";
    }
    if (status === 403) {
      return method.toUpperCase() === "PUT"
        ? "MinerU 轻量解析文件上传被拒绝（403）。上传签名可能已失效，请稍后重试。"
        : "MinerU 轻量解析请求被拒绝（403）。请稍后重试。";
    }
    if (status === 408 || status === 504) {
      return "MinerU 轻量解析请求超时。请稍后重试，或填写 Token 改用精准解析 API。";
    }
    if (status >= 500) {
      return `MinerU 轻量解析服务暂时不可用（${status}）。请稍后重试。`;
    }
    return `MinerU 轻量解析请求失败（${status}）。请稍后重试，或填写 Token 改用精准解析 API。`;
  }

  private static formatPreciseCodeMessage(code: MineruCode | undefined, fallback?: string) {
    const normalized = String(code ?? "").trim();
    const mapped: Record<string, string> = {
      A0202: "MinerU 精准解析 API 的 Token 无效。请检查 Token 是否正确，且不要手动填写 Bearer 前缀。",
      A0211: "MinerU 精准解析 API 的 Token 已过期。请更换新的 Token。",
      "-500": "MinerU 精准解析参数错误。请检查请求参数和 Content-Type 设置。",
      "-10001": "MinerU 精准解析服务异常，请稍后再试。",
      "-10002": "MinerU 精准解析请求参数错误。请检查模型、语言和文件参数。",
      "-60001": "MinerU 无法生成上传链接，请稍后再试。",
      "-60002": "MinerU 检测文件格式失败。请确认文件名带有正确后缀，且文件类型受支持。",
      "-60003": "MinerU 读取文件失败。请检查 PDF 是否损坏后重试。",
      "-60004": "上传的文件为空，请重新选择有效文件。",
      "-60005": "文件大小超出精准解析 API 限制（最大 200MB）。请压缩或拆分文件后重试。",
      "-60006": "文件页数超出精准解析 API 限制（最大 600 页）。请拆分文件后重试。",
      "-60007": "MinerU 模型服务暂时不可用，请稍后重试。",
      "-60008": "MinerU 读取文件超时，请检查文件或稍后重试。",
      "-60009": "MinerU 任务提交队列已满，请稍后再试。",
      "-60010": "MinerU 解析失败，请稍后再试。",
      "-60011": "MinerU 未获取到有效文件，请确认文件已成功上传。",
      "-60012": "MinerU 找不到对应任务，请稍后重试。",
      "-60013": "当前账号没有权限访问该 MinerU 任务。",
      "-60014": "运行中的 MinerU 任务暂不支持删除。",
      "-60015": "文件转换失败。建议先手动转换为 PDF 再上传。",
      "-60016": "文件导出为指定格式失败，请尝试其他导出格式或稍后重试。",
      "-60017": "MinerU 重试次数已达上限，请稍后再试。",
      "-60018": "MinerU 今日精准解析额度已达上限，请明日再试。",
      "-60019": "MinerU 的 HTML 解析额度不足，请明日再试。",
      "-60020": "MinerU 文件拆分失败，请稍后重试。",
      "-60021": "MinerU 读取文件页数失败，请稍后重试。",
      "-60022": "MinerU 网页读取失败。可能是网络问题或限频导致，请稍后重试。",
    };

    if (normalized && mapped[normalized]) {
      return mapped[normalized];
    }
    if (fallback?.trim()) {
      return `MinerU 精准解析失败：${fallback.trim()}`;
    }
    return "MinerU 精准解析失败，请检查 Token、文件大小和页数限制后重试。";
  }

  private static formatAgentCodeMessage(code: MineruCode | undefined, fallback?: string) {
    const normalized = String(code ?? "").trim();
    const mapped: Record<string, string> = {
      "-30001": "MinerU 轻量解析接口不支持该文件大小（最大 10MB）。请填写 Token 改用精准解析 API，或先拆分文件。",
      "-30002": "MinerU 轻量解析接口不支持该文件类型。请上传 PDF、图片、Doc/PPT/Excel 等受支持文件。",
      "-30003": "MinerU 轻量解析接口不支持当前页数（最大 20 页）。请填写 Token 改用精准解析 API，或先拆分文件。",
      "-30004": "MinerU 轻量解析请求参数错误。请检查文件名和必填参数。",
    };

    if (normalized && mapped[normalized]) {
      return mapped[normalized];
    }
    if (fallback?.trim()) {
      return `MinerU 轻量解析失败：${fallback.trim()}`;
    }
    return "MinerU 轻量解析失败。该模式无需 Token，但有 10MB、20 页和 IP 限频限制。";
  }

  private static extractErrorMessage(error: unknown) {
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === "string" && error) {
      return error;
    }
    if (error && typeof error === "object") {
      const maybeMessage = Reflect.get(error, "message");
      if (typeof maybeMessage === "string" && maybeMessage) {
        return maybeMessage;
      }
      try {
        const stringified = String(error);
        if (stringified && stringified !== "[object Object]") {
          return stringified;
        }
      } catch {
        // ignore stringification failures
      }
      try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== "{}") {
          return serialized;
        }
      } catch {
        // ignore serialization failures
      }
    }
    return "";
  }
}

