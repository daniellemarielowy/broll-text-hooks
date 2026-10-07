// Hook Lab server function (Vercel).
// Keeps your Anthropic API key private: the browser sends the client's answers here,
// this function adds the writing rules and calls Claude, then streams the hooks back.
//
// Settings (add these in Vercel > Project > Settings > Environment Variables):
//   ANTHROPIC_API_KEY  required  your key from console.anthropic.com
//   ACCESS_CODE        optional  if set, people must enter this code to use the tool
//   ANTHROPIC_MODEL    optional  defaults to claude-sonnet-5-5

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";

// Approved example hooks from three niches. They teach Claude the style.
// They live only on the server, so visitors to the page never see them.
const EXAMPLES = [
  "You've spent the last two years getting certified in spiritual modalities, but when a client books a session, you still deliver the same coaching you offered before you learned any of them. There's a reason those certifications haven't changed how you work with clients.",
  "You keep getting an intuitive hit halfway through a client session, but you swallow it because she hired you for business strategy and you have no idea if she'll receive it or end up just canceling her next session. Here's how I'd introduce it so she's actually open to hearing it.",
  "POV: Your 2pm Thursday client booked a \"60-Minute Business Strategy Call\" off a sales page you wrote 2 years ago, and you already know you want to do energy clearing before you touch her funnel. You just have no idea how to make that switch without sounding crazy.",
  "Your favorite client just asked to renew for another six months, and instead of excitement you felt dread, because renewing means another half year of reviewing her launch metrics when you'd rather be doing the intuitive work you got certified in last spring.",
  "You did everything right: the career, the kids, the business you're proud of. So why does the version of you who has all of it feel more depleted and less like herself than the one who was still chasing it?",
  "Before kids, you could write a full sales page in one afternoon and still have energy for a workout and dinner with friends. Now it takes you 2 nap times to finish one email, and you keep wondering where that woman went. She didn't disappear, there's a very specific reason you can't reach her right now.",
  "You look at photos of yourself launching your business three years ago, before the second baby, and you don't just miss how you looked. You miss how you felt: sharp, fast, unstoppable. Everyone keeps telling you this is just \"mom life,\" but what if it's something no one has actually checked?",
  "You told yourself you'd feel like you again once the baby was sleeping through the night. Then once you hired the nanny, the VA and the OBM. Then once your youngest started preschool. You've outsourced everything you can, your youngest is in kindergarten, and you're still too tired to do the parts of your business only you can do. There's one thing you haven't outsourced and it's the reason nothing else has worked.",
  "You'd never keep a client who ghosts you for four days and then shows up acting like nothing happened, but that's exactly the man who has your full attention right now. Meanwhile the one who texts back, makes plans and tells you how he feels? You're bored. That pull you feel isn't chemistry.",
  "You crossed $200K in your business, hired a team, and stopped taking client calls on weekends. But you're still leaving Saturday open for a man who said \"maybe we can hang out\" on Tuesday. Here's where you start organizing your life around him before there's even a relationship.",
  "Six months ago you never missed your 6am workout, you were posting content every day, and you were booked out three weeks in advance. Now you've rearranged your entire calendar around his schedule and you can't remember the last time you did something just for you. Here's how it happens so slowly you don't notice.",
  "Your friends describe you as the strongest woman they know: you built a six-figure business from nothing, you handle every crisis, and you never ask for help. Then you get home from dinner and spend an hour wondering if he's pulling away because you're \"too much.\" There's a reason you're two different women when it comes to men."
];

const RULES = `You write upper-funnel Instagram trial reel hooks: on-screen text over B-roll, shown to people who don't follow the account yet. The goal is that the exact right woman stops scrolling because she feels personally caught, and follows.

What makes these hooks work (study the approved examples closely and match their voice, length and rhythm):
- Hyper-specific. When you think you've gone specific, go more specific. Use concrete numbers (years in business, revenue like $200K, dollar amounts, kids' ages, times like 2pm Thursday or 3:33am, "three Fridays in a row"), named tools and places (Calendly, Stripe notification, Slack, Zoom, intake form, Target parking lot, school pickup line), and real roles (VA, OBM, nanny, COO).
- Stack her real-life markers first (what she's built, what she's done right), then land on one private moment she'd never say out loud. The contrast between where she's in control and where she's not creates the tension.
- Written in second person ("you"), present tense, like you're describing her week back to her.
- End every hook with an open loop that makes her need the rest of the reel, without giving the answer: "There's a reason...", "Here's...", "That's not...", "...isn't chemistry.", "what if it's something no one has actually checked?"
- Be honest: the open loop must point toward what the business owner actually helps with. No bait-and-switch.
- Never diagnose, shame, or promise results.
- 30-75 words each. Plain, conversational language. No hashtags, no emojis, no em dashes.
- Vary the formats across the 20, for example: "POV:" scene; "You told yourself you'd ... once ... Then once ... Then once ..." timeline; "You'd never ... in your business, but ..." contrast; "Before X, you ... Now ..." before/after; "You've hired/tried ..., but ..." already-tried; "Your friends describe you as ... Then ..." public vs private; "You did everything right ..." achievement paradox. Don't start two hooks with the same words.
- Every hook should feel written for this one audience, not reusable for another niche.

APPROVED EXAMPLES from three other niches (style reference only; never reuse their details unless the brief matches):
${EXAMPLES.map((h) => "- " + h).join("\n")}`;

const LABELS = [
  ["offer", "What the business owner does and sells"],
  ["who", "Exact viewer (her ideal client)"],
  ["strong", "Where the viewer is confident"],
  ["pain", "Where she is stuck"],
  ["private", "Private moments"],
  ["tried", "Already tried"],
  ["told", "What she tells herself / is told"],
  ["want", "What she wants"],
  ["words", "Audience's exact phrases"],
  ["avoid", "Avoid"],
];

// Best-effort limit per server instance: 15 requests per visitor per hour.
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 15;
}

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function buildBrief(f) {
  const lines = LABELS.map(([k, label]) => [label, clean(f[k], 2000)])
    .filter(([, v]) => v)
    .map(([label, v]) => label + ": " + v)
    .join("\n");
  const research = clean(f.research, 12000);
  return "BRIEF FROM THE BUSINESS OWNER:\n" + lines +
    (research ? "\n\nSOURCE MATERIAL (market research, sales page or call notes; mine it for real details and language):\n" + research : "");
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ needsCode: Boolean(process.env.ACCESS_CODE) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "The site isn't set up yet: ANTHROPIC_API_KEY is missing." });
  }

  const body = typeof req.body === "string" ? safeJson(req.body) : req.body || {};
  if (process.env.ACCESS_CODE && clean(body.code, 200) !== process.env.ACCESS_CODE) {
    return res.status(401).json({ error: "That access code isn't right. Check it and try again." });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) {
    return res.status(429).json({ error: "You've hit the hourly limit. Try again in a little while." });
  }

  const f = body.fields || {};
  for (const k of ["offer", "who", "pain", "private"]) {
    if (!clean(f[k], 10)) return res.status(400).json({ error: "Fill in the required questions first." });
  }
  const brief = buildBrief(f);
  const direction = clean(f.direction, 300);

  if (body.mode === "sharpen") {
    const hook = clean(body.hook, 1500);
    if (!hook) return res.status(400).json({ error: "No hook to rewrite." });
    const prompt = RULES + "\n\n" + brief +
      "\n\nRewrite this one hook to be even more hyper-specific: add concrete numbers, named moments, tools or places from her real life, and keep a strong open loop at the end. Keep it under 80 words.\n\nHOOK: " + hook +
      '\n\nReply with only a JSON object and nothing else: {"hook": "..."}';
    try {
      const r = await callClaude(prompt, 600, false);
      if (!r.ok) return res.status(502).json({ error: await upstreamError(r) });
      const data = await r.json();
      const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      const match = text.match(/\{[\s\S]*\}/);
      const out = match ? safeJson(match[0]) : null;
      if (!out || typeof out.hook !== "string") return res.status(502).json({ error: "Claude didn't return a hook. Try again." });
      return res.status(200).json({ hook: out.hook.trim() });
    } catch {
      return res.status(502).json({ error: "Couldn't reach Claude. Try again." });
    }
  }

  // Default: write 20 hooks and stream them back as they're written.
  const prompt = RULES + "\n\n" + brief +
    (direction ? "\n\nDIRECTION FOR THIS BATCH: " + direction : "") +
    '\n\nWrite exactly 20 hooks for the ideal client in this brief. Output one JSON object per line and nothing else: no intro, no numbering, no code fence. Each line: {"hook": "...", "format": "2-3 word format name", "angle": "2-5 word angle"}';

  let upstream;
  try {
    upstream = await callClaude(prompt, 6000, true);
  } catch {
    return res.status(502).json({ error: "Couldn't reach Claude. Try again." });
  }
  if (!upstream.ok) return res.status(502).json({ error: await upstreamError(upstream) });

  res.status(200);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  req.on("close", () => { try { reader.cancel(); } catch {} });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split("\n");
      buf = events.pop();
      for (const line of events) {
        if (!line.startsWith("data:")) continue;
        const ev = safeJson(line.slice(5).trim());
        if (ev && ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
          res.write(ev.delta.text);
        }
      }
    }
  } catch {
    // Connection dropped mid-answer: send what we have.
  }
  res.end();
}

function callClaude(prompt, maxTokens, stream) {
  return fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      stream,
      messages: [{ role: "user", content: prompt }],
    }),
  });
}

async function upstreamError(r) {
  if (r.status === 429) return "Too many requests right now. Wait a minute and try again.";
  if (r.status === 401) return "The site's API key isn't working. The site owner needs to check it.";
  if (r.status === 400) {
    const t = await r.text().catch(() => "");
    if (/credit|billing/i.test(t)) return "The site is out of API credits. The site owner needs to add more.";
    if (/model/i.test(t)) return "The site's model setting isn't valid. The site owner needs to check ANTHROPIC_MODEL.";
  }
  return "Claude is busy or unavailable right now. Try again in a minute.";
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}
