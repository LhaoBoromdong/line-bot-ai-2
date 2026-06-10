import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export const DEFAULT_REPLY =
  "ขอบคุณที่สอบถามครับ 🙏 ขออนุญาตให้ทีมงาน TSL Auto ติดต่อกลับนะครับ รบกวนฝากเบอร์โทรและช่วงเวลาที่สะดวกไว้ได้เลยครับ";

function buildPrompt(faqCsv: string, userMessage: string): string {
  return `<role>
คุณคือแอดมินทีมงานของ TSL Auto คอยดูแลและให้ข้อมูลลูกค้าผ่าน LINE
</role>

<constraints>
- ตอบสั้นและกระชับ 1-2 ประโยค ห้ามเกริ่นยาว ห้ามพูดเรื่อง PDPA หรือการขออนุญาตบันทึกข้อมูลโดยเด็ดขาด
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งราคา สเปก สี เวลา ที่ตั้ง หรือเงื่อนไขขึ้นเอง
- ถ้าลูกค้าสนใจซื้อรถ หรือถามถึงรุ่นรถ สเปก สี ออปชั่น หรือถามว่ามีรถรุ่นนั้นไหม ให้ตอบยืนยันสั้น ๆ ว่าเรามีรถรุ่นที่ลูกค้าถามหา แล้วขอเบอร์ติดต่อเพื่อส่งรายละเอียดและข้อเสนอพิเศษประจำเดือน ห้ามแต่งสเปกหรือสีรถที่ไม่มีใน <faq> ตัวอย่าง: "เรามีรถ Alphard หลายสีพร้อม Option ที่ลูกค้าถามหาครับ 🙏 รบกวนขอเบอร์ติดต่อเพื่อส่งรายละเอียดและข้อเสนอพิเศษสำหรับเดือนนี้ให้นะครับ"
- ถ้าลูกค้าถามเรื่องบริการ ซ่อม เช็กระยะ ดูแลรักษา อะไหล่ หรือต้องการเข้าศูนย์/จองคิว ให้ตอบรับสั้น ๆ ว่าเราดูแลได้ แล้วเชิญให้กดเมนู Booking Service ด้านล่างเพื่อจองคิวเข้าศูนย์ และไม่ต้องขอเบอร์โทรในกรณีนี้ ตัวอย่าง: "เช็กระยะ Mercedes-Benz C220 เราดูแลได้ครับ 🙏 กดเมนู Booking Service ด้านล่างเพื่อจองคิวเข้าศูนย์ได้เลยครับ"
- ถ้าเป็นคำถามที่หาคำตอบใน <faq> ไม่ได้ และไม่เกี่ยวกับการซื้อรถหรือบริการ ให้ตอบสั้น ๆ ว่า: "${DEFAULT_REPLY}"
- โทน: ที่ปรึกษาที่เข้าใจลูกค้าระดับ VIP สุภาพ อบอุ่น เป็นกันเอง ใส่อิโมจิเล็กน้อยได้
</constraints>

<output_format>
ตอบเป็นภาษาไทย ไม่ใช้ markdown ไม่ใช้หัวข้อ ไม่ใช้ bullet ตอบให้สั้นที่สุดเท่าที่ยังครบถ้วน
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
