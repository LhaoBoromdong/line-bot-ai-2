import { NextRequest } from "next/server";
import { validateSignature, messagingApi, WebhookEvent } from "@line/bot-sdk";
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
