/**
 * 错误文案归一化。
 *
 * 三件事，按顺序：
 * 1. 剥掉库的异常包装，还原成后端给的那句话
 * 2. 兜住「后端没给消息」的情况 —— 空的报错比报错本身更让人困惑
 * 3. 兜住「后端给了非预期结构」的情况
 *
 * 抽出来是因为这段逻辑在好几个页面重复，而它恰恰是**用户唯一能看到的技术细节** ——
 * 同一个错误在聊天页显示「登录已过期」而在设置页显示「[object Object]」，
 * 是很难排查的一类问题。
 */

import { ApiError } from "@/api/http";

export function errText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.message || fallback;
  }
  if (err instanceof Error) {
    return err.message || fallback;
  }
  if (typeof err === "string" && err.trim()) {
    return err;
  }
  return fallback;
}
