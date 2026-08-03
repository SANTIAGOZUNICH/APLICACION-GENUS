import type { MetadataRoute } from "next";

/** Disallow crawling of the private admin surface. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/administracion/", "/api/v1/auth/admin/"],
    },
  };
}
