declare module "pako" {
  export interface DeflateOptions {
    level?: number;
  }

  export function deflate(data: Uint8Array, options?: DeflateOptions): Uint8Array;

  const pako: {
    deflate: typeof deflate;
  };

  export default pako;
}
