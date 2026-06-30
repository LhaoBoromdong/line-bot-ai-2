import { NextRequest } from "next/server";
import { validateSignature, messagingApi, WebhookEvent, FollowEvent, HTTPFetchError } from "@line/bot-sdk";
import { getFaqCsv } from "@/lib/sheet";
import { askGemini, withTimeout, DEFAULT_REPLY } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const channelSecret = process.env.LINE_CHANNEL_SECRET!;
const client = new messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
});

// เก็บ userId ลูกค้าที่เรียกบอทฉุกเฉินตอนกลางวันไว้ — อยู่ได้แค่ตราบที่ instance ยัง warm
// (Vercel serverless: instance ใหม่/cold start จะรีเซ็ตค่านี้ ลูกค้าอาจต้องพิมพ์คีย์เวิร์ดซ้ำ)
const activeBotUsers = new Set<string>();

const OPEN_KEYWORDS = ["ถามบอท", "ถาม ai", "ai"];
const CLOSE_KEYWORDS = ["ติดต่อแอดมิน", "ติดต่อพนักงาน"];
const BOT_READY_REPLY = "ระบบ AI TSL Auto พร้อมให้บริการแล้วครับ คุณลูกค้ามีเรื่องใดให้ผมดูแล แจ้งได้เลยครับ";
const HANDOFF_REPLY = "รับทราบครับ ระบบได้ส่งเรื่องให้แอดมินเรียบร้อยแล้ว กรุณารอสักครู่นะครับ";

// บอทตอบเองช่วงกลางคืน 22:00-07:59 (Asia/Bangkok) — กลางวันให้แอดมินตอบ เว้นแต่ลูกค้าเรียกบอทฉุกเฉิน
function isBotHoursBangkok(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return hour >= 22 || hour < 8;
}

// ตัดช่องว่างออกก่อนเทียบ — กันเคสลูกค้าพิมพ์เว้นวรรคกลางคีย์เวิร์ด เช่น "ถาม บอท"
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function matchesKeyword(message: string, keywords: string[]): boolean {
  const normalizedMessage = normalizeForMatch(message);
  return keywords.some((kw) => normalizedMessage.includes(normalizeForMatch(kw)));
}

// HTTPFetchError.message คือแค่ "400 - Bad Request" ตัวเหตุผลจริง (เช่น invalid/expired reply token,
// ข้อความว่าง, ยาวเกิน 5000 ตัวอักษร) อยู่ใน .body — log แยกเพื่อ debug ผ่าน Vercel Logs ได้
function logLineError(context: string, err: unknown) {
  if (err instanceof HTTPFetchError) {
    console.error(`[${context}]`, err.status, err.body);
  } else {
    console.error(`[${context}]`, err);
  }
}

async function safeReply(replyToken: string, text: string) {
  try {
    await client.replyMessage({ replyToken, messages: [{ type: "text", text }] });
  } catch (err) {
    logLineError("webhook reply", err);
  }
}

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
  const userId = event.source.userId;

  if (!isBotHoursBangkok()) {
    const isActive = userId ? activeBotUsers.has(userId) : false;

    // ลูกค้าที่คุยกับบอทอยู่ ขอคืนแชทให้แอดมิน
    if (isActive && matchesKeyword(userMessage, CLOSE_KEYWORDS)) {
      if (userId) activeBotUsers.delete(userId);
      await safeReply(replyToken, HANDOFF_REPLY);
      return;
    }

    // ลูกค้ายังไม่ได้เรียกบอท — เช็กคีย์เวิร์ดเปิดบอทฉุกเฉิน ไม่งั้นเงียบรอแอดมิน
    if (!isActive) {
      if (userId && matchesKeyword(userMessage, OPEN_KEYWORDS)) {
        activeBotUsers.add(userId);
        await safeReply(replyToken, BOT_READY_REPLY);
      }
      return;
    }
    // isActive และไม่ได้พิมพ์คำปิดบอท — ส่งต่อให้ Gemini ตอบต่อเนื่องตามปกติด้านล่าง
  }

  try {
    const faqCsv = await getFaqCsv();
    const reply = await withTimeout(askGemini(faqCsv, userMessage), 8000, DEFAULT_REPLY);

    await client.replyMessage({
      replyToken,
      messages: [{ type: "text", text: reply }],
    });
  } catch (err) {
    logLineError("webhook", err);
    await safeReply(replyToken, DEFAULT_REPLY);
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
    logLineError("follow getProfile", err);
  }

  await safeReply(replyToken, buildGreeting(name));
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

ทีมงานพร้อมดูแลคุณเป็นการส่วนตัวครับ หรือโทร 02-269-9999

หากคุณลูกค้ามีข้อสงสัยหรือต้องการทราบข้อมูลเบื้องต้นทันที สามารถพิมพ์คำว่า "ถามบอท" หรือ "AI" เพื่อให้ระบบผู้ช่วยอัจฉริยะของเราดูแลคุณได้ทันทีครับ! 🤖✨`;
}
