import { NextResponse } from 'next/server';
import { getSql, initDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDb();
    const sql = getSql();

    const [leadsCount] = await sql`SELECT COUNT(*)::int AS count FROM leads;`;
    const [sessionsCount] = await sql`SELECT COUNT(*)::int AS count FROM sessions;`;
    const [nichesCount] = await sql`SELECT COUNT(DISTINCT clean_niche)::int AS count FROM leads;`;
    const [phonesCount] = await sql`SELECT COUNT(*)::int AS count FROM leads WHERE clean_phone IS NOT NULL AND length(clean_phone) >= 10;`;

    return NextResponse.json({
      total_leads: leadsCount?.count || 0,
      total_sessions: sessionsCount?.count || 0,
      total_niches: nichesCount?.count || 0,
      leads_with_phone: phonesCount?.count || 0,
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    return NextResponse.json({
      total_leads: 0,
      total_sessions: 0,
      total_niches: 0,
      leads_with_phone: 0,
    });
  }
}
