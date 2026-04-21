import { NextResponse } from 'next/server';
import { getPendingReviewCounts } from '@/lib/review-count';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const { total, platformCounts } = await getPendingReviewCounts();
    return NextResponse.json({ count: total, platformCounts });
  } catch {
    return NextResponse.json({ count: 0, platformCounts: [] });
  }
}
