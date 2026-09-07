import { ImageResponse } from "next/og";
import { mascotIconSvg } from "@/lib/mascotIcon";

export async function GET() {
  return new ImageResponse(mascotIconSvg(512), { width: 512, height: 512 });
}
