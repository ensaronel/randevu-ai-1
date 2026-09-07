import { ImageResponse } from "next/og";
import { mascotIconSvg } from "@/lib/mascotIcon";

// manifest.ts'in sabit bir yolla referans verebilmesi için — icon.tsx
// convention'ı Next'in kendi favicon boyutunu üretir, PWA manifest'i ise
// 192/512 gibi kesin boyutlu, sabit URL'ler ister.
export async function GET() {
  return new ImageResponse(mascotIconSvg(192), { width: 192, height: 192 });
}
