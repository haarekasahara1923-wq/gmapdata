import { NextResponse } from 'next/server';
import { getSql, initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    await initDb();
    const sql = getSql();
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get('session_id');
    const niche = searchParams.get('niche');

    let leads = [];

    if (sessionId) {
      leads = await sql`
        SELECT * FROM leads 
        WHERE session_id = ${sessionId} 
        ORDER BY id ASC;
      `;
    } else if (niche) {
      leads = await sql`
        SELECT * FROM leads 
        WHERE niche = ${niche} 
        ORDER BY id ASC;
      `;
    } else {
      leads = await sql`
        SELECT * FROM leads 
        ORDER BY id DESC 
        LIMIT 500;
      `;
    }

    return NextResponse.json({ leads, count: leads.length });
  } catch (err) {
    console.error('Error fetching leads:', err);
    return NextResponse.json({ leads: [], count: 0 });
  }
}
