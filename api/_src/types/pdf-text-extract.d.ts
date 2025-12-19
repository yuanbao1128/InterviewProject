declare module 'pdf-text-extract' {
  type Callback = (err: any, pages: string[] | string) => void;
  interface Options {
    splitPages?: boolean; // 默认 true
    // 其余选项用 any 兜底
    [k: string]: any;
  }
  // 该库同时支持 (filePath, options?, cb) 与 (buffer, options?, cb)
  function extract(input: string | Buffer, options: Options | Callback, cb?: Callback): void;
  export = extract;
}