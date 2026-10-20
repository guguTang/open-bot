/**
 * React Compiler 目前无法编译带 `finally` 的 try 语句（"Handle TryStatement with a
 * finalizer"），整个组件会因此放弃自动 memo。组件里改用这两个 helper：
 * 普通模块函数不会被编译器处理，语义与 try/finally 完全一致（正常、抛错、catch 重抛都会执行 onFinally）。
 */
export async function runWithFinally<T>(body: () => Promise<T>, onFinally: () => void): Promise<T> {
  try {
    return await body();
  } finally {
    onFinally();
  }
}

export function runWithFinallySync<T>(body: () => T, onFinally: () => void): T {
  try {
    return body();
  } finally {
    onFinally();
  }
}
