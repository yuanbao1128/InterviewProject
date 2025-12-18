// api/src/types/pdfjs-dist.d.ts
declare module 'pdfjs-dist' {
  export const GlobalWorkerOptions: { workerSrc: any }
  export function getDocument(data: any): { promise: Promise<any> }
}

declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  const src: any
  export default src
}