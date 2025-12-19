declare module 'pdf-text-extract' {
  type Callback = (err: any, pages: string[] | string) => void;

  // 有的实现仅支持 filePath 或 filePaths 数组；不保证支持 Buffer 或对象
  function extract(filePath: string, cb: Callback): void;
  function extract(filePaths: string[], cb: Callback): void;

  // 某些分叉实现可能支持 (filePath, options, cb)，这里做个兼容声明：
  function extract(filePath: string, options: any, cb: Callback): void;
  function extract(filePaths: string[], options: any, cb: Callback): void;

  export = extract;
}