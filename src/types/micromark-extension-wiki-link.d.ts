declare module "micromark-extension-wiki-link" {
  import type { Extension } from "micromark-util-types";

  export function syntax(options?: { readonly aliasDivider?: string }): Extension;
}
