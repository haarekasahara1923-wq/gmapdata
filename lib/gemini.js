const MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-flash-latest'];

export async function extractLeadsWithGemini(niche, location, count = 20, excludeNames = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured.');
  }

  const excludeHint = excludeNames.length > 0 
    ? ` Do NOT include these already extracted businesses: ${excludeNames.slice(-10).join(', ')}.`
    : '';

  const prompt = `You are a verified business directory data extractor for Google Maps.
Extract ${count + 3} real, genuine businesses with authentic contact details for:
Business / Niche: ${niche}
Location / City: ${location || 'India'}
${excludeHint}

Return ONLY a valid JSON array of objects with these exact keys:
[
  {
    "name": "Official business or clinic name",
    "phone": "Real contact phone number with STD or mobile code",
    "whatsapp": "10-digit mobile number or phone number for WhatsApp",
    "email": "Business email address if available or null",
    "website": "Official website URL with https:// or null",
    "address": "Accurate street and area address",
    "rating": 4.5,
    "reviews_count": 150
  }
]
`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  };

  let lastError = null;

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (resp.ok) {
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              return parsed;
            }
          } catch (e) {
            const match = text.match(/\[.*\]/s);
            if (match) {
              return JSON.parse(match[0]);
            }
          }
        }
      } else if (resp.status === 429) {
        lastError = `Rate limit reached on ${model}`;
        continue;
      } else {
        const errText = await resp.text();
        lastError = `Gemini API error (${resp.status}): ${errText}`;
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  throw new Error(lastError || 'Failed to extract leads with Gemini API');
}
