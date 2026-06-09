import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const DEFAULT_REPLY =
  "ขอบคุณที่สอบถามครับ 🙏 เรื่องนี้ขอให้ทีมงาน TSL Auto ติดต่อกลับเพื่อให้ข้อมูลที่ถูกต้องและครบถ้วนนะครับ " +
  "รบกวนฝากเบอร์โทรและช่วงเวลาที่สะดวกให้ติดต่อกลับไว้ตรงนี้ได้เลยครับ เดี๋ยวทีมงานติดต่อกลับโดยเร็วที่สุด";

function buildPrompt(faqCsv: string, userMessage: string): string {
  return `<role>
คุณคือแอดมินทีมงานของ TSL Auto คอยดูแลและให้ข้อมูลลูกค้าผ่าน LINE
</role>

<constraints>
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งราคา เวลา ที่ตั้ง หรือเงื่อนไขขึ้นเอง
- ถ้าคำถามไม่มีคำตอบใน <faq> ให้ตอบกลับด้วยข้อความนี้คำต่อคำ: "${DEFAULT_REPLY}"
- โทน: ที่ปรึกษาที่เข้าใจลูกค้าระดับ VIP สุภาพ อบอุ่น เป็นกันเอง ใส่อิโมจินิดหน่อยได้ตามบริบท
- ความยาว 1-3 ประโยคเป็นหลัก ถ้าจำเป็นต้องอธิบายมากกว่านั้นได้ แต่อย่าเยิ่นเย้อ
</constraints>

<output_format>
ตอบเป็นภาษาไทย ไม่ใช้ markdown ไม่ใช้หัวข้อ ไม่ใช้ bullet
</output_format>

<faq>
${faqCsv}
</faq>

<question>
${userMessage}
</question>`;
}

export async function askGemini(faqCsv: string, userMessage: string): Promise<string> {
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: buildPrompt(faqCsv, userMessage),
    config: {
      temperature: 1.0,
      maxOutputTokens: 1024,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const finishReason = response.candidates?.[0]?.finishReason;
  const usage = response.usageMetadata;

  console.log("[gemini]", {
    finishReason,
    thoughtsTokenCount: usage?.thoughtsTokenCount,
    candidatesTokenCount: usage?.candidatesTokenCount,
    totalTokenCount: usage?.totalTokenCount,
  });

  if (finishReason === "MAX_TOKENS") {
    console.warn("[gemini] MAX_TOKENS — ส่ง default_reply แทน");
    return DEFAULT_REPLY;
  }

  const text = response.text?.trim();
  return text && text.length > 0 ? text : DEFAULT_REPLY;
}

export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
