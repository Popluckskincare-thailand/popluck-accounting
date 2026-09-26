// jev.mjs — "System One" typed decisions, รันในเครื่องล้วน
//
// แนวคิดยืมมาจาก typesafe.ai / madewithjev.com / bespokelabs Nimble:
//   อย่าให้โมเดล "เขียนข้อความ" ถ้าสิ่งที่เราต้องการคือ "การตัดสินใจ"
//   ให้มัน prefill context แล้วอ่านความน่าจะเป็นของ token แรกตัวเดียว
//
// ที่นี่ทำได้จริงเพราะ Ollama คืน logprobs/top_logprobs มาให้
//   -> num_predict: 1  (สร้าง token เดียว)
//   -> softmax เฉพาะ token ที่เป็นตัวเลือก แล้ว normalize
//   -> ได้ {answer, confidence, probs} แบบ calibrated ใช้เวลา ~100-300ms ตอนโมเดลอุ่น
//
// เทียบกับการให้โมเดลตอบเป็นประโยค: เร็วกว่าหลายสิบเท่า และ parse ไม่พลาด

// ตัวเลือกใช้ตัวอักษรเพราะเป็น single token เสมอ จับคู่กลับได้แม่น
// ต้องมีมากพอสำหรับทุกหมวด — เคยมีแค่ A-H แล้วพอเพิ่มหมวดที่ 9 ตัวตัดสินใจพังเงียบ ๆ
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

async function firstTokenProbs(ollama, model, prompt, candidates, signal) {
  const r = await fetch(`${ollama}/api/chat`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      logprobs: true,
      top_logprobs: 20,
      options: { num_predict: 1, temperature: 0, num_ctx: 2048 },
    }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const top = data?.logprobs?.[0]?.top_logprobs || [];

  // จับคู่ token -> ตัวเลือก (ตัดช่องว่าง/ตัวพิมพ์ทิ้ง เพราะ tokenizer ชอบแถม " " มาให้)
  const raw = {};
  for (const c of candidates) raw[c] = -Infinity;
  for (const t of top) {
    const key = String(t.token).trim().toLowerCase();
    const hit = candidates.find((c) => c.toLowerCase() === key);
    if (hit && t.logprob > raw[hit]) raw[hit] = t.logprob;
  }
  // ถ้าไม่เจอเลย ใช้ token ที่โมเดลเลือกจริงเป็น fallback
  const greedy = String(data?.message?.content || '').trim().toLowerCase();
  if (candidates.every((c) => raw[c] === -Infinity)) {
    const hit = candidates.find((c) => c.toLowerCase() === greedy) || candidates[0];
    raw[hit] = 0;
  }

  // softmax เฉพาะในเซตตัวเลือก
  const max = Math.max(...candidates.map((c) => raw[c]));
  let sum = 0;
  const probs = {};
  for (const c of candidates) {
    const v = raw[c] === -Infinity ? 0 : Math.exp(raw[c] - max);
    probs[c] = v;
    sum += v;
  }
  for (const c of candidates) probs[c] = sum ? probs[c] / sum : 1 / candidates.length;
  return probs;
}

/**
 * decide({kind:'choice'|'score'|'bool', ...}) -> {answer, confidence, probs, ms}
 *   choice: options: [{id, label}]      -> answer = id
 *   score:  levels: ['ต่ำ','กลาง','สูง'] -> answer = ชื่อระดับ
 *   bool:                                -> answer = true/false
 */
export async function decide(ollama, model, { kind, state = '', question, options, levels }, signal) {
  const t0 = Date.now();
  let prompt, candidates, map;

  if (kind === 'bool') {
    candidates = ['yes', 'no'];
    prompt = `${state ? state + '\n\n' : ''}${question}\nAnswer with exactly one word: yes or no.\nAnswer:`;
    map = (c) => c === 'yes';
  } else {
    const list = kind === 'score' ? levels.map((l) => ({ id: l, label: l })) : options;
    if (list.length > LETTERS.length) {
      throw new Error(`ตัวเลือกมี ${list.length} ข้อ เกินจำนวนตัวอักษรที่รองรับ (${LETTERS.length})`);
    }
    candidates = list.map((_, i) => LETTERS[i]);
    const menu = list.map((o, i) => `${LETTERS[i]}) ${o.label}`).join('\n');
    prompt = `${state ? state + '\n\n' : ''}${question}\n${menu}\nAnswer with exactly one letter.\nAnswer:`;
    map = (c) => list[LETTERS.indexOf(c)].id;
  }

  const probs = await firstTokenProbs(ollama, model, prompt, candidates, signal);
  const best = candidates.reduce((a, b) => (probs[a] >= probs[b] ? a : b));
  const out = {};
  for (const c of candidates) out[map(c)] = +probs[c].toFixed(4);
  return { answer: map(best), confidence: +probs[best].toFixed(4), probs: out, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Router: ตัดสินใจเรื่องเดียว -> ข้อความนี้ควรส่งไปทางไหน
// ประหยัดทั้งเวลาและแรงเครื่อง เพราะไม่ต้องปลุกโมเดลใหญ่/เปิดโหมดคิดทุกครั้ง
// ---------------------------------------------------------------------------

export const ROUTES = {
  quick: { label: 'ทักทาย เล่นสนุก หรือถามข้อเท็จจริงสั้น ๆ ที่ตอบได้ใน 1-2 บรรทัด', think: false },
  chat: { label: 'ขออธิบายความรู้ ให้คำแนะนำ หรือคุยเรื่องทั่วไปที่ต้องตอบยาว', think: false },
  code: { label: 'โค้ด โปรแกรม คำสั่งเทอร์มินัล บั๊ก ระบบ ไอที', think: false },
  reason: { label: 'โจทย์เลข ตรรกะ คำนวณ หรือวางแผนที่ต้องคิดหลายขั้น', think: true },
  analyze: { label: 'ขอให้วิเคราะห์ ตีความ ประเมิน เปรียบเทียบ หรือให้ความเห็นเชิงลึกต่อเรื่องใดเรื่องหนึ่ง', think: true },
  thai: { label: 'งานเขียนภาษาไทย เช่น แคปชั่น โพสต์ บทความ สคริปต์ อีเมล แปลไทย', think: false },
  vision: { label: 'ถามเกี่ยวกับรูปภาพที่แนบมา', think: false },
  image: { label: 'ขอให้วาด/สร้าง/ออกแบบรูปภาพขึ้นมาใหม่', think: false },
  computer: { label: 'สั่งให้ลงมือทำบนเครื่องแทน เช่น เปิดแอป คลิก พิมพ์ กดปุ่ม', think: false },
};

/**
 * จัดหมวดข้อความ
 *
 * สำคัญ: ต้องดู "บริบท" ด้วย ไม่ใช่ดูแค่ข้อความล่าสุด
 * เคยพลาดมาแล้ว — ผู้ใช้ขอให้วิเคราะห์ดวง แล้วตอบข้อมูลวันเกิดสั้น ๆ กลับมา
 * ตัวจัดเส้นทางเห็นแค่ "16 มีนาคม 2536" เลยจัดเป็น quick (โหมดตอบสั้น)
 * งานวิเคราะห์ที่กำลังทำอยู่เลยกลายเป็นตอบห้วน ๆ ว่าข้อมูลไม่พอ
 *
 * @param prev  หมวดของคำตอบก่อนหน้า (ถ้ามี)
 * @param ctx   บทสนทนาล่าสุดสั้น ๆ ไว้ให้ตัวจัดเส้นทางเห็นภาพ
 */
export async function route(ollama, model, text, hasImage, signal, prev, ctx) {
  if (hasImage) {
    return { answer: 'vision', confidence: 1, probs: { vision: 1 }, ms: 0, forced: true };
  }
  const options = Object.entries(ROUTES).map(([id, v]) => ({ id, label: v.label }));

  let state = '';
  if (ctx) state += `บทสนทนาก่อนหน้า:\n"""${String(ctx).slice(0, 900)}"""\n\n`;
  state += `ข้อความล่าสุดจากผู้ใช้:\n"""${text.slice(0, 1200)}"""`;
  if (prev && ROUTES[prev]) {
    state += `\n\n(คำตอบก่อนหน้าอยู่ในหมวด "${prev}")`;
  }

  return decide(
    ollama,
    model,
    {
      kind: 'choice',
      state,
      question:
        'ข้อความล่าสุดควรอยู่ในหมวดไหน? ' +
        'ถ้าเป็นการให้ข้อมูลเพิ่มหรือตอบคำถามที่ผู้ช่วยเพิ่งถาม ให้เลือกหมวดเดิมที่กำลังทำงานอยู่ ' +
        'ไม่ใช่ดูแค่ว่าข้อความสั้นหรือยาว',
      options,
    },
    signal
  );
}
