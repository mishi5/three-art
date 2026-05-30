// Bun の file loader 経由で import したアセットは URL 文字列に解決される (Issue #53)。
declare module "*.svg" {
  const url: string;
  export default url;
}
