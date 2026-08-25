export const virtualAtlasViewSchemaVersion = "1.0.0";

export interface VirtualAtlasView {
  readonly files: ReadonlyMap<string, string>;
}

export interface VirtualAtlasChange {
  readonly content: string;
  readonly path: string;
}
