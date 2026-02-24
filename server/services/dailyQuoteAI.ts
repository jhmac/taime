import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db';
import { eq, and, gte, sql } from 'drizzle-orm';
import { dailyQuotes, dailyQuoteHistory } from '@shared/schema';
import { config } from '../lib/config';
import logger from '../lib/logger';
import { createHash } from 'crypto';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const MODEL = 'claude-sonnet-4-20250514';

const FALLBACK_QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Small daily improvements are the key to staggering long-term results.", author: "Robin Sharma" },
  { text: "Every day, in every way, I'm getting better and better.", author: "Emile Coue" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Excellence is not a destination but a continuously growing never-ending process.", author: "Brian Tracy" },
  { text: "Where there is no standard, there can be no kaizen.", author: "Taiichi Ohno" },
  { text: "Without standards, there can be no improvement.", author: "Taiichi Ohno" },
  { text: "Progress, not perfection.", author: "Paul Akers" },
  { text: "A bad system will beat a good person every time.", author: "W. Edwards Deming" },
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Aristotle" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese Proverb" },
  { text: "Don't find fault, find a remedy.", author: "Henry Ford" },
  { text: "Continuous improvement is better than delayed perfection.", author: "Mark Twain" },
  { text: "Be not afraid of going slowly. Be afraid only of standing still.", author: "Chinese Proverb" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "The standard you walk past is the standard you accept.", author: "David Morrison" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "Fix what bugs you. If something annoys you, fix it right now.", author: "Paul Akers" },
  { text: "Lean is spelled P-E-O-P-L-E. Grow your people first.", author: "Paul Akers" },
  { text: "The most dangerous kind of waste is the waste we do not recognize.", author: "Shigeo Shingo" },
  { text: "Great things are done by a series of small things brought together.", author: "Vincent Van Gogh" },
  { text: "Strive for progress, not perfection.", author: "Unknown" },
  { text: "What gets measured gets improved.", author: "Peter Drucker" },
  { text: "The biggest room in the world is the room for improvement.", author: "Helmut Schmidt" },
  { text: "If you always do what you've always done, you'll always get what you've always got.", author: "Henry Ford" },
  { text: "Quality means doing it right when no one is looking.", author: "Henry Ford" },
  { text: "Learning is not compulsory. Neither is survival.", author: "W. Edwards Deming" },
  { text: "One piece of flow is the ideal — finish what you start before starting something new.", author: "Lean Principle" },
  { text: "Go see, ask why, show respect.", author: "Fujio Cho" },
];

function hashQuote(text: string): string {
  return createHash('sha256').update(text.toLowerCase().trim()).digest('hex').slice(0, 16);
}

export async function generateDailyQuote(storeId: string, date: Date): Promise<{ quoteText: string; quoteAuthor: string }> {
  const dateStr = date.toISOString().slice(0, 10);

  const [existing] = await db.select().from(dailyQuotes)
    .where(and(eq(dailyQuotes.storeId, storeId), eq(dailyQuotes.quoteDate, dateStr)));

  if (existing) {
    return { quoteText: existing.quoteText, quoteAuthor: existing.quoteAuthor };
  }

  const ninetyDaysAgo = new Date(date);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  const recentHashes = await db.select({ hash: dailyQuoteHistory.quoteTextHash })
    .from(dailyQuoteHistory)
    .where(and(
      eq(dailyQuoteHistory.storeId, storeId),
      gte(dailyQuoteHistory.usedDate, ninetyDaysAgo.toISOString().slice(0, 10))
    )).catch(() => []);

  const usedHashes = new Set(recentHashes.map(r => r.hash));

  try {
    const systemPrompt = `Generate one powerful, inspiring quote about improvement, self-improvement, continuous growth, or excellence in craft.

The quote should resonate with retail team members — people who work hard on their feet, take pride in creating beautiful store experiences, and are learning to see waste and fix problems.

Sources can include: lean thinkers (Taiichi Ohno, Paul Akers, W. Edwards Deming), business leaders, athletes, philosophers, authors, or your own original wisdom.

Return JSON only, no markdown: { "quote_text": "the quote", "quote_author": "attribution" }

${usedHashes.size > 0 ? `Do NOT use any of these previously used quotes (identified by hash):\n${[...usedHashes].join('\n')}` : ''}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system: systemPrompt,
      messages: [{ role: 'user', content: `Generate today's improvement quote for ${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` }],
    }, { signal: controller.signal });

    clearTimeout(timeout);

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Expected text response');

    const text = content.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const result = JSON.parse(text);

    const hash = hashQuote(result.quote_text);

    if (usedHashes.has(hash)) {
      logger.warn({ storeId }, 'AI returned a duplicate quote, using fallback');
      return useFallback(storeId, dateStr, usedHashes);
    }

    await db.insert(dailyQuotes).values({
      storeId,
      quoteDate: dateStr,
      quoteText: result.quote_text,
      quoteAuthor: result.quote_author,
      generatedByAi: true,
    }).catch(() => {});

    await db.insert(dailyQuoteHistory).values({
      storeId,
      quoteTextHash: hash,
      usedDate: dateStr,
    }).catch(() => {});

    logger.info({ storeId, date: dateStr }, 'Daily quote generated successfully');
    return { quoteText: result.quote_text, quoteAuthor: result.quote_author };

  } catch (error: any) {
    logger.error({ storeId, error: error.message }, 'Failed to generate daily quote via AI, using fallback');
    return useFallback(storeId, dateStr, usedHashes);
  }
}

async function useFallback(storeId: string, dateStr: string, usedHashes: Set<string>): Promise<{ quoteText: string; quoteAuthor: string }> {
  const available = FALLBACK_QUOTES.filter(q => !usedHashes.has(hashQuote(q.text)));
  const quote = available.length > 0
    ? available[Math.floor(Math.random() * available.length)]
    : FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];

  const hash = hashQuote(quote.text);

  await db.insert(dailyQuotes).values({
    storeId,
    quoteDate: dateStr,
    quoteText: quote.text,
    quoteAuthor: quote.author,
    generatedByAi: false,
  }).onConflictDoNothing().catch(() => {});

  await db.insert(dailyQuoteHistory).values({
    storeId,
    quoteTextHash: hash,
    usedDate: dateStr,
  }).catch(() => {});

  return { quoteText: quote.text, quoteAuthor: quote.author };
}
