import { NextResponse } from 'next/server';
import { getSql, initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDb();
    const sql = getSql();
    const sessions = await sql`
      SELECT * FROM sessions 
      ORDER BY created_at DESC 
      LIMIT 100;
    `;
    return NextResponse.json({ sessions, count: sessions.length });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    return NextResponse.json({ sessions: [], count: 0 });
  }
}
