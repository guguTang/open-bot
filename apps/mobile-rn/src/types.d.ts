/**
 * Uniwind / Tailwind 的 className 由编译期转换，TS 不需要知道具体类名；
 * 这里只是为了让 `import "../global.css"` 这种副作用导入通过类型检查。
 */
declare module "*.css";

/**
 * React Native 的 `FormData` 运行时支持 `{ uri, name, type }` 这种文件描述对象，
 * 但 TS 选的是 DOM lib 的重载（只认 `string | Blob`），导致上传本地文件时编译不过。
 *
 * 这里放宽 append 的签名，与 RN 官方文档的用法一致。**只放宽这一个方法**，
 * 保留其余 DOM 行为，避免整块 FormData 被改成 any 把类型检查关掉。
 */
declare global {
  interface FormData {
    append(name: string, value: string | Blob): void;
    append(
      name: string,
      value: { uri: string; name: string; type: string },
      fileName?: string
    ): void;
  }
}

export {};
