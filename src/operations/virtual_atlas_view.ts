import { compareCodePoints } from "../atlas/compare_code_points.ts";
import type { AtlasTextFile, CapturedAtlasFile } from "../atlas/load_atlas_text.ts";
import { sha256Hex } from "../atlas/sha256.ts";
import type {
  VirtualAtlasChange,
  VirtualAtlasView,
} from "../domain/virtual_atlas_view.ts";

const encoder = new TextEncoder();

export function createVirtualAtlasView(
  changes: readonly VirtualAtlasChange[],
): VirtualAtlasView {
  const files = new Map<string, string>();
  for (const change of changes) {
    files.set(change.path, change.content);
  }
  return Object.freeze({ files });
}

export function applyVirtualAtlasChanges(
  view: VirtualAtlasView,
  changes: readonly VirtualAtlasChange[],
): VirtualAtlasView {
  const files = new Map(view.files);
  for (const change of changes) {
    files.set(change.path, change.content);
  }
  return Object.freeze({ files });
}

export function virtualAtlasTextFiles(
  view: VirtualAtlasView,
): readonly AtlasTextFile[] {
  return Object.freeze(
    [...view.files.entries()]
      .map(([path, content]) => Object.freeze({ content, path }))
      .sort((left, right) => compareCodePoints(left.path, right.path)),
  );
}

export function virtualAtlasCapturedFiles(
  view: VirtualAtlasView,
): readonly CapturedAtlasFile[] {
  return Object.freeze(
    virtualAtlasTextFiles(view).map((file) =>
      Object.freeze({ bytes: encoder.encode(file.content), path: file.path }),
    ),
  );
}

export function virtualAtlasDigest(view: VirtualAtlasView): string {
  return sha256Hex(
    virtualAtlasTextFiles(view)
      .map((file) => `${file.path}\0${sha256Hex(file.content)}`)
      .join("\0"),
  );
}
