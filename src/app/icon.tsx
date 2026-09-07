import { ImageResponse } from "next/og";
import { mascotIconSvg } from "@/lib/mascotIcon";

export const size = { width: 48, height: 48 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(mascotIconSvg(48), size);
}
