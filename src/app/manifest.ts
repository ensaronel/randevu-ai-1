import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Randevu AI",
    short_name: "Randevu AI",
    description: "Randevu bazlı işletmeler için AI destekli yönetim sistemi",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f5f3ec",
    theme_color: "#1e2e4f",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
