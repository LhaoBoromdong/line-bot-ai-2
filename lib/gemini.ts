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
- ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น ห้ามแต่งราคา เวลา ที่ตั้ง หรือเงื่อนไขขึ้นเอง
- ถ้าลูกค้าถามเรื่องบริการ ซ่อม เช็กระยะ ดูแลรักษา อะไหล่ หรือต้องการเข้าศูนย์/จองคิว ให้ตอบรับสั้น ๆ ว่าเราดูแลได้ แล้วเชิญให้กดเมนู Booking Service ด้านล่างเพื่อจองคิวเข้าศูนย์ หรือรบกวนฝากเบอร์โทรและช่วงเวลาที่สะดวกไว้ได้เลยครับ ตัวอย่าง: "เช็กระยะ Mercedes-Benz C220 เราดูแลได้ครับ 🙏 กดเมนู Booking Service ด้านล่างเพื่อจองคิวเข้าศูนย์ได้เลยครับ หรือฝากเบอร์โทรและช่วงเวลาที่สะดวกไว้ได้เลยครับ"
- ถ้าเป็นคำถามที่หาคำตอบใน <faq> ไม่ได้ และไม่เกี่ยวกับบริการหรือการจองคิว ให้ตอบสั้น ๆ ว่า: "${DEFAULT_REPLY}"
- ถ้าลูกค้าทักทาย (เช่น สวัสดี หวัดดี ดีครับ ฯลฯ) ให้ทักทายกลับอย่างอบอุ่นและถามว่ามีอะไรให้ช่วยเหลือได้บ้าง
- ถ้าลูกค้าให้เบอร์โทรมาแต่ไม่ได้ระบุเวลาที่สะดวก ให้ขอบคุณแล้วถามเวลาที่สะดวกให้ติดต่อกลับ
- ถ้าลูกค้าให้ทั้งเบอร์และเวลาครบแล้ว ให้ขอบคุณและยืนยันว่าทีมงาน TSL Auto จะติดต่อกลับตามเวลาที่แจ้ง
- ถ้าลูกค้าส่งข้อความที่เป็นวัน/เวลา (เช่น พรุ่งนี้ วันจันทร์ ช่วงเช้า บ่ายสอง 14.00 ฯลฯ) ให้ถือว่าลูกค้าแจ้งเวลาสะดวกให้โทรกลับ ให้ขอบคุณและยืนยันสั้น ๆ
- โทน: ที่ปรึกษาที่เข้าใจลูกค้าระดับ VIP สุภาพ อบอุ่น เป็นกันเอง ใส่อิโมจิเล็กน้อยได้
</constraints>

<output_format>
- ตรวจจับภาษาที่ลูกค้าใช้แล้วตอบให้ตรงภาษานั้น: ลูกค้าเขียนภาษาไทย → ตอบภาษาไทย / ลูกค้าเขียนภาษาอังกฤษ → ตอบภาษาอังกฤษ / ลูกค้าผสมทั้งสองภาษา → ตอบภาษาไทยเป็นหลัก
- ถ้าตอบภาษาอังกฤษ ให้ใช้ "you" แทน "คุณลูกค้า" และ "I" แทน "ผม/ดิฉัน"
- ตอบเป็นภาษาไทย ไม่ใช้ markdown ไม่ใช้หัวข้อ ไม่ใช้ bullet ตอบให้สั้นที่สุดเท่าที่ยังครบถ้วน
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
