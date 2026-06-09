import { NextRequest } from "next/server";
import { validateSignature, messagingApi, WebhookEvent, FollowEvent } from "@line/bot-sdk";
import { getFaqCsv } from "@/lib/sheet";
import { askGemini, withTimeout, DEFAULT_REPLY } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channelSecret = process.env.LINE_CHANNEL_SECRET!;
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-line-signature") ?? "";

  if (!validateSignature(rawBody, channelSecret, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const events: WebhookEvent[] = JSON.parse(rawBody).events ?? [];

  await Promise.all(events.map(handleEvent));

  return new Response("OK", { status: 200 });
}

async function handleEvent(event: WebhookEvent) {
  if (event.type === "follow") {
    return handleFollow(event);
  }

  if (event.type !== "message" || event.message.type !== "text") return;

  const replyToken = event.replyToken;
  const userMessage = event.message.text;

  try {
    const faqCsv = await getFaqCsv();
    const reply = await withTimeout(askGemini(faqCsv, userMessage), 8000, DEFAULT_REPLY);

    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: reply }],
    });
  } catch (err) {
    console.error("[webhook] error:", err);
    try {
      await client.replyMessage({
        replyToken,
        messages: [{ type: "text", text: DEFAULT_REPLY }],
      });
    } catch (replyErr) {
      console.error("[webhook] reply failed:", replyErr);
    }
  }
}

async function handleFollow(event: FollowEvent) {
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  let name = "";
  try {
    if (userId) {
      const profile = await client.getProfile(userId);
      name = profile.displayName ?? "";
    }
  } catch (err) {
    console.warn("[follow] getProfile failed:", err);
  }

  try {
    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: buildGreeting(name) }],
    });
  } catch (err) {
    console.error("[follow] reply failed:", err);
  }
}

function buildGreeting(name: string): string {
  const hello = name ? `สวัสดีครับ คุณ${name} 🙏` : "สวัสดีครับ 🙏";
  return `${hello}
ยินดีต้อนรับสู่ TSL Auto

เราคือผู้เชี่ยวชาญด้านรถยนต์ระดับพรีเมียมครบวงจร นำเข้า จำหน่าย ตรวจสอบ และดูแลรักษา ด้วยประสบการณ์กว่า 4 ทศวรรษ

มีเรื่องรถให้เราดูแล ทักมาได้เลยครับ ไม่ว่าจะเป็น
🚗 เลือกซื้อรถพรีเมียมและรถไฟฟ้า
🔍 ตรวจสภาพรถมือสองก่อนซื้อ — TSL Certified
🛠️ ซ่อมสี ตัวถัง เช็กระยะ ที่ศูนย์บริการ
🛡️ ประกันภัยและคำปรึกษา

ทีมงานพร้อมดูแลคุณเป็นการส่วนตัวครับ หรือโทร 02-269-9999`;
}
