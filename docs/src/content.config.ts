// Astro 6+ content config — replaces the legacy src/content/config.ts.
// Each collection now needs an explicit loader. For Starlight, the docsLoader
// glob-walks src/content/docs/ which is what the old default behavior did.
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
};
