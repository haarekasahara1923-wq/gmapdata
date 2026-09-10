import { NextResponse } from 'next/server';
import { getSql, initDb, normalizePhone, normalizeText } from '@/lib/db';
import { extractLeadsWithGemini } from '@/lib/gemini';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    await initDb();
    const sql = getSql();
    const body = await request.json();

    const niche = (body.niche || '').trim();
    const location = (body.location || '').trim();
    const maxRequested = parseInt(body.max_results || 20, 10);

    if (!niche) {
      return NextResponse.json({ error: 'Niche is required' }, { status: 400 });
    }

    const cleanNiche = normalizeText(niche);
    const query = location ? `${niche} in ${location}` : niche;
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Create session
    await sql`
      INSERT INTO sessions (session_id, niche, location, query, max_requested, status)
      VALUES (${sessionId}, ${niche}, ${location}, ${query}, ${maxRequested}, 'running')
      ON CONFLICT (session_id) DO NOTHING;
    `;

    // Extract leads via Gemini
    const extractedItems = await extractLeadsWithGemini(niche, location, maxRequested);

    let newCount = 0;
    let skippedCount = 0;
    const savedLeads = [];

    for (const item of extractedItems) {
      const name = String(item.name || '').trim();
      if (!name) continue;

      const cleanName = normalizeText(name);
      const phone = String(item.phone || '').trim();
      const cleanPhone = normalizePhone(phone);
      const whatsapp = normalizePhone(String(item.whatsapp || phone));
      const email = item.email && item.email !== 'null' && item.email.includes('@') ? item.email.trim() : null;
      const website = item.website && item.website.startsWith('http') ? item.website.trim() : null;
      const address = String(item.address || '').trim();
      const rating = parseFloat(item.rating || 0.0) || 0.0;
      const reviewsCount = parseInt(item.reviews_count || 0, 10) || 0;
      const placeId = `lead_${Math.abs(hashString(cleanName + cleanPhone))}`;
      const mapUrl = `https://www.google.com/maps/search/${encodeURIComponent(name + ' ' + (location || ''))}`;

      // Check deduplication
      let duplicate = false;

      if (cleanPhone && cleanPhone.length >= 10) {
        const existingByPhone = await sql`
          SELECT id FROM leads 
          WHERE clean_niche = ${cleanNiche} AND clean_phone = ${cleanPhone} 
          LIMIT 1;
        `;
        if (existingByPhone.length > 0) duplicate = true;
      }

      if (!duplicate && cleanName) {
        const existingByName = await sql`
          SELECT id FROM leads 
          WHERE clean_niche = ${cleanNiche} AND LOWER(name) = ${cleanName} 
          LIMIT 1;
        `;
        if (existingByName.length > 0) duplicate = true;
      }

      if (duplicate) {
        skippedCount++;
        continue;
      }

      // Save new lead
      const inserted = await sql`
        INSERT INTO leads (
          niche, clean_niche, query, name, phone, clean_phone, whatsapp,
          email, website, address, rating, reviews_count, place_id, map_url, session_id
        ) VALUES (
          ${niche}, ${cleanNiche}, ${query}, ${name}, ${phone}, ${cleanPhone}, ${whatsapp},
          ${email}, ${website}, ${address}, ${rating}, ${reviewsCount}, ${placeId}, ${mapUrl}, ${sessionId}
        ) RETURNING *;
      `;

      if (inserted && inserted.length > 0) {
        newCount++;
        savedLeads.push(inserted[0]);
      }
    }

    // Update session
    await sql`
      UPDATE sessions 
      SET new_count = ${newCount}, skipped_count = ${skippedCount}, status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE session_id = ${sessionId};
    `;

    return NextResponse.json({
      success: true,
      session_id: sessionId,
      niche,
      location,
      new_count: newCount,
      skipped_count: skippedCount,
      leads: savedLeads,
      status: 'completed',
    });
  } catch (err) {
    console.error('Extraction error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}
